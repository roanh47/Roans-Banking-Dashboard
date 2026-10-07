"""Saldo's van rekeningen die niet in de PSD2-consent zitten.

De betaalrekening komt live van de bank. De spaarrekeningen en IBKR zitten niet
in de consent van Rabobank, dus daarvan geeft de bank niets terug. Voor die
rekeningen geldt:

    saldo = ijkpunt (uit Firefly, met datum) + elke interne overboeking daarna

Geld dat van de betaalrekening naar de spaarrekening gaat telt er dus bij op, en
geld dat van de spaarrekening terugkomt gaat er weer af. Zo loopt het saldo mee
zonder dat de bank het levert.
"""

from app.database import get_db

# Overboekingen herkennen we aan het IBAN van de tegenpartij als de bank dat
# meestuurt. Rabobank doet dat via PSD2 niet, dus in de praktijk doen de
# trefwoorden per rekening het werk. Deze lijst is alleen om te signaleren dat er
# geld ergens heen gaat dat nergens aan hangt.
CANDIDATE_HINTS = (
    "spaar", "ibkr", "belegg", "investeren", "obk", "degiro", "aandelen",
    "crypto", "bitvavo",
)
# Wise, Revolut en TradingShenzhen staan hier bewust NIET: dat zijn uitgaven van
# de betaalrekening, geen pot waar geld heen en weer gaat.


def _norm(waarde) -> str:
    return (waarde or "").replace(" ", "").upper()


def keywords(rekening) -> list:
    """Trefwoorden voor deze rekening; valt terug op de naam."""
    eigen = [k.strip().lower() for k in (rekening["keywords"] or "").split(",") if k.strip()]
    if eigen:
        return eigen
    return [rekening["label"].lower()] if rekening["label"] else []


def match(rij, rekening):
    """Waarom hoort deze transactie bij deze rekening? None als hij er niet bij hoort."""
    tegen = _norm(rij["counterparty_iban"])
    for doel in (rekening["iban"], rekening["account_number"]):
        if doel and _norm(doel) == tegen:
            return f"IBAN {doel}"
    tekst = f'{rij["description"] or ""} {rij["merchant_name"] or ""}'.lower()
    for woord in keywords(rekening):
        if woord in tekst:
            return f"keyword '{woord}'"
    return None


def _transacties(conn):
    return conn.execute(
        """SELECT t.* FROM transactions t
           JOIN accounts a ON a.id = t.account_id
           ORDER BY t.booking_date"""
    ).fetchall()


def _koppelparen(rijen, koppel):
    """Overboekingen van deze rekening herkennen aan de betaling die eruit betaald is.

    Geld dat van de spaarrekening naar de betaalrekening gaat staat in het
    afschrift als een bijschrijving op naam van de rekeninghouder zelf. Welke
    spaarrekening het was, zegt de bank niet. Wat wel zichtbaar is: dezelfde dag,
    hetzelfde bedrag, betaald aan bijvoorbeeld de hogeschool. Die paren rekenen
    we mee.
    """
    uit = {}
    for betaling in rijen:
        if (betaling["amount"] or 0) >= 0:
            continue
        if koppel not in (betaling["description"] or "").lower():
            continue
        for binnen in rijen:
            if (binnen["amount"] or 0) != -(betaling["amount"] or 0):
                continue
            if (binnen["booking_date"] or "")[:10] != (betaling["booking_date"] or "")[:10]:
                continue
            uit[str(binnen["id"])] = (
                f"paid to {koppel}: {abs(betaling['amount']):.2f} on {betaling['booking_date']}"
            )
    return uit


def moves_for(conn, rekening, rijen=None):
    """Interne overboekingen die bij deze rekening horen.

    Alles wat we kunnen vinden komt erin, ook boekingen van vóór het ijkpunt van
    Firefly: die tellen niet mee voor het saldo (ze zitten al in het ijkpunt),
    maar ze zijn wel de geschiedenis van de rekening.
    """
    if rijen is None:
        rijen = _transacties(conn)
    ijkpunt = (rekening["balance_date"] or "")[:10]
    paren = {}
    for woord in keywords(rekening):
        if woord.startswith("koppel="):
            paren.update(_koppelparen(rijen, woord.split("=", 1)[1]))
    uit = []
    for rij in rijen:
        dag = (rij["booking_date"] or "")[:10]
        waarom = match(rij, rekening) or paren.get(str(rij["id"]))
        if not waarom:
            continue
        bedrag = abs(rij["amount"] or 0.0)
        richting = 1 if (rij["amount"] or 0.0) < 0 else -1
        uit.append({
            "date": dag,
            "amount": round(richting * bedrag, 2),
            "description": rij["description"] or "",
            "matched_by": waarom,
            # Al in het ijkpunt van Firefly verwerkt: wel tonen, niet meetellen.
            "voor_ijkpunt": bool(ijkpunt and dag <= ijkpunt),
            # Zodat het dashboard kan doorklikken naar de transactie op de
            # betaalrekening waar deze boeking vandaan komt.
            "tx_id": rij["id"],
            "account_id": rij["account_id"],
        })
    return uit


def links_for(conn, rijen):
    """Per transactie: naar welke voorspelde rekening hij toe gaat.

    Zo kun je in het dashboard op een overboeking naar de spaarrekening of IBKR
    klikken en de bijbehorende boeking op die rekening zien."""
    rekeningen = conn.execute(
        "SELECT * FROM external_accounts WHERE COALESCE(active, 1) = 1 ORDER BY kind, label"
    ).fetchall()
    uit = {}
    parens_per_rekening = {}
    for rek in rekeningen:
        parens = {}
        for woord in keywords(rek):
            if woord.startswith("koppel="):
                parens.update(_koppelparen(rijen, woord.split("=", 1)[1]))
        parens_per_rekening[rek["key"]] = parens
    for rij in rijen:
        for rek in rekeningen:
            waarom = match(rij, rek) or parens_per_rekening[rek["key"]].get(str(rij["id"]))
            if waarom:
                uit[str(rij["id"])] = {
                    "key": rek["key"],
                    "name": rek["label"],
                    "matched_by": waarom,
                }
                break
    return uit


def candidates(conn, rekeningen=None):
    """Overboekingen met een verdacht trefwoord die nergens aan hangen."""
    if rekeningen is None:
        rekeningen = conn.execute("SELECT * FROM external_accounts WHERE COALESCE(active, 1) = 1").fetchall()
    rijen = conn.execute(
        "SELECT * FROM transactions ORDER BY booking_date DESC LIMIT 4000"
    ).fetchall()
    uit = []
    for rij in rijen:
        tekst = f'{rij["description"] or ""} {rij["merchant_name"] or ""}'.lower()
        if not any(hint in tekst for hint in CANDIDATE_HINTS):
            continue
        if any(match(rij, rek) for rek in rekeningen):
            continue
        uit.append({
            "date": (rij["booking_date"] or "")[:10],
            "amount": round(rij["amount"] or 0.0, 2),
            "description": rij["description"] or "",
        })
    return uit[:40]


def derived_accounts(conn=None):
    """Alle niet-live rekeningen met een voorspeld saldo."""
    eigen_conn = conn is None
    if eigen_conn:
        conn = get_db()
    rijen = _transacties(conn)
    uit = []
    for rekening in conn.execute("SELECT * FROM external_accounts ORDER BY kind, label").fetchall():
        bewegingen = moves_for(conn, rekening, rijen)
        # Boekingen van vóór het ijkpunt zitten al in het saldo van Firefly.
        delta = round(sum(b["amount"] for b in bewegingen if not b["voor_ijkpunt"]), 2)
        ijkpunt = round(float(rekening["balance"] or 0.0), 2)
        uit.append({
            "id": rekening["id"],
            "key": rekening["key"],
            "name": rekening["label"],
            "kind": rekening["kind"] or "savings",
            "iban": rekening["iban"],
            "account_number": rekening["account_number"],
            "balance": round(ijkpunt + delta, 2),
            "baseline": ijkpunt,
            "baseline_date": (rekening["balance_date"] or "")[:10],
            "delta": delta,
            "moves": bewegingen,
            "predicted": True,
            "source": rekening["source"],
            "updated_at": rekening["updated_at"],
        })
    resultaat = {"accounts": uit, "candidates": candidates(conn)}
    if eigen_conn:
        conn.close()
    return resultaat


def external_totals(conn=None):
    data = derived_accounts(conn)
    return round(sum(a["balance"] for a in data["accounts"]), 2), len(data["accounts"])
