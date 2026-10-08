from fastapi import APIRouter
from app.database import get_db
from app.enable_banking import EnableBankingClient
from app.routers.auth import parse_account, session_validity, store_accounts
from datetime import datetime, timedelta
from app.categorize import categorize, learned_map

import json
import requests
import time
import uuid

router = APIRouter(prefix="/api", tags=["sync"])

# Volledige historiek ophalen: Rabobank weigert een date_from die te ver terug
# ligt met een ASPSP_ERROR. Het venster is een rollend aantal jaren, dus we
# beginnen bij de grens en schuiven per maand op naar voren tot de bank de datum
# accepteert. Zo halen we het oudste op dat de bank op dit moment kan geven --
# met een vaste datumlijst (2000/2010/2015/2019) sloegen we jaren over die de
# bank wél levert.
HISTORY_MAX_YEARS = 8
HISTORY_DAYS_AGO = 90


def history_start(history_from=None):
    """Startdatum van de historiek-opvraag.

    De bank levert een rollend venster (HISTORY_MAX_YEARS jaar terug). We vragen
    altijd vanaf een dag VOOR de oudste boeking die we al hebben -- en nooit
    vanaf een datum die de bank niet meer levert. Daardoor kan de ondergrens
    nooit over een dag heen schuiven: de grens-dag blijft binnen elk verzoek en
    wordt telkens opnieuw opgehaald (upsert, dus geen dubbele rijen).
    """
    vandaag = datetime.utcnow().date()
    grens = vandaag - timedelta(days=365 * HISTORY_MAX_YEARS)
    if not history_from:
        return grens
    try:
        oudste = datetime.strptime(str(history_from)[:10], "%Y-%m-%d").date()
    except (ValueError, TypeError):
        return grens
    return max(grens, oudste - timedelta(days=1))


def history_candidates(start=None, cap=None):
    """Datums die de sync achtereenvolgens probeert, van oud naar nieuw.

    cap = de dag voor de oudste boeking die we al hebben. De sync schuift nooit
    voorbij die dag op, ook niet als de bank een datum weigert. Daardoor zit de
    grens-dag in elke poging en kan hij niet tussen twee syncs verdwijnen.
    """
    vandaag = datetime.utcnow().date()
    begin = start or history_start()
    recent = vandaag - timedelta(days=HISTORY_DAYS_AGO)
    kandidaten = []
    maanden = 0
    while maanden < 120:
        datum = begin + timedelta(days=30 * maanden)
        if datum >= recent or (cap and datum > cap):
            break
        kandidaten.append(datum.strftime("%Y-%m-%d"))
        maanden += 1
    if not kandidaten:
        kandidaten.append(begin.strftime("%Y-%m-%d"))
    # Het recente venster is het laatste redmiddel, maar alleen als onze eigen
    # ondergrens daar niet voor zou komen te liggen.
    recent_str = recent.strftime("%Y-%m-%d")
    if recent_str not in kandidaten and (not cap or recent <= cap):
        kandidaten.append(recent_str)
    return tuple(kandidaten)


def _iban_uit_rekening(rekening) -> str:
    """IBAN (of ander rekeningnummer) uit een rekeningblok van de bank-API."""
    if not isinstance(rekening, dict):
        return ""
    for sleutel in ("iban", "other"):
        waarde = rekening.get(sleutel)
        if isinstance(waarde, dict):
            waarde = waarde.get("identification")
        if waarde:
            return str(waarde).replace(" ", "")
    return ""


def _iban_van_tegenpartij(tx: dict, cdi: str) -> str:
    """IBAN van de tegenpartij, voor zover de bank die meestuurt.

    Rabobank zet het rekeningblok op het hoogste niveau van de boeking
    (`creditor_account` bij een afschrijving, `debtor_account` bij een
    bijschrijving). Het oudere pad `creditor.account_id` blijft als terugval
    staan, want dat gebruiken andere ASPSP's wel.
    """
    tegenpartij = tx.get("creditor") if cdi == "DBIT" else tx.get("debtor")
    if not isinstance(tegenpartij, dict):
        tegenpartij = tx.get("creditor") or tx.get("debtor") or {}
    if not isinstance(tegenpartij, dict):
        tegenpartij = {}

    # Eerst de eigen kant van de boeking, dan de andere kant.
    for kant in (("creditor", "debtor") if cdi == "DBIT" else ("debtor", "creditor")):
        iban = _iban_uit_rekening(tx.get(f"{kant}_account"))
        if iban:
            return iban
    return _iban_uit_rekening(tegenpartij.get("account_id"))


def _tekst(waarde) -> str:
    """Vrije tekst uit de bank-API als één string.

    Rabobank stuurt `remittance_information` als lijst; andere banken als string.
    """
    if isinstance(waarde, (list, tuple)):
        return "\n".join(str(x).strip() for x in waarde if str(x).strip())
    if waarde is None:
        return ""
    return str(waarde).strip()


def _code(tx: dict, sleutel: str) -> str:
    """Eén veld uit het bank_transaction_code-blok, als tekst."""
    blok = tx.get("bank_transaction_code")
    if not isinstance(blok, dict):
        return ""
    waarde = blok.get(sleutel)
    return "" if waarde is None else str(waarde)


@router.get("/sync")
def sync_all():
    """Sync balances and transactions for all connected bank accounts."""
    conn = get_db()
    # Eén keer per sync: hoe zijn deze tegenpartijen de vorige keren ingedeeld?
    learned = learned_map(conn)
    # Losgekoppelde banken slaan we over; hun historiek blijft wel staan.
    connections = conn.execute(
        "SELECT * FROM bank_connections WHERE COALESCE(status, '') <> 'REMOVED'"
    ).fetchall()
    vooraf = conn.execute("SELECT COUNT(*) FROM transactions").fetchone()[0]
    synced_count = 0
    rapport = []

    for bank_conn in connections:
        client = EnableBankingClient()
        session_id = bank_conn["auth_token"]
        melding = {
            "id": bank_conn["id"],
            "bank_name": bank_conn["bank_name"],
            "status": bank_conn["status"],
            "valid_until": bank_conn["valid_until"],
            "error": None,
            "accounts": 0,
            "transactions": 0,
        }

        # 1. Sessie verversen: status + geldigheid. Een verlopen sessie geeft 401.
        try:
            session_data = client.get_session(session_id)
        except requests.HTTPError as e:
            tekst = ""
            try:
                tekst = e.response.text[:300]
            except Exception:
                tekst = str(e)
            if "EXPIRED_SESSION" in tekst or "expired" in tekst.lower():
                melding["status"] = "EXPIRED"
                melding["error"] = "Bank session expired; reconnect"
            else:
                melding["error"] = f"Bank error: {tekst}"
            conn.execute(
                """UPDATE bank_connections SET status = ?, last_checked = datetime('now'),
                   last_error = ? WHERE id = ?""",
                (melding["status"], melding["error"], bank_conn["id"]),
            )
            conn.commit()
            rapport.append(melding)
            continue
        except Exception as e:
            melding["error"] = f"No connection: {e}"
            conn.execute(
                "UPDATE bank_connections SET last_checked = datetime('now'), last_error = ? WHERE id = ?",
                (melding["error"], bank_conn["id"]),
            )
            conn.commit()
            rapport.append(melding)
            continue

        status, valid_until = session_validity(session_data)
        melding["status"] = status or bank_conn["status"]
        melding["valid_until"] = valid_until or bank_conn["valid_until"]
        conn.execute(
            """UPDATE bank_connections SET status = ?, valid_until = ?, last_checked = datetime('now'),
               last_error = NULL WHERE id = ?""",
            (melding["status"], melding["valid_until"], bank_conn["id"]),
        )
        conn.commit()

        # 2. Rekeningen bijwerken: uid van de bank naar provider_uid, lokale id blijft.
        try:
            store_accounts(conn, bank_conn["id"], session_data.get("accounts") or [])
            conn.commit()
        except Exception:
            pass

        rows = conn.execute(
            "SELECT * FROM accounts WHERE connection_id = ?", (bank_conn["id"],)
        ).fetchall()
        melding["accounts"] = len(rows)

        for account in rows:
            uid = account["provider_uid"] or account["id"]

            # De sessie geeft alleen uids. Naam en IBAN halen we apart op, anders
            # staat er "Account 1" zonder rekeningnummer in het dashboard.
            if not account["iban"]:
                try:
                    details = client.account_details(uid)
                    iban = ""
                    acc_id = details.get("account_id") or {}
                    if isinstance(acc_id, dict):
                        iban = acc_id.get("iban") or ""
                    # Rabobank stuurt hier de naam van de houder ("A. Voorbeeld"),
                    # niet de rekeningnaam. Voor een betaalrekening tonen we daarom
                    # "Betaalrekening".
                    naam = details.get("name") or details.get("display_name") or ""
                    if (account["kind"] or "").lower() in ("checking", "cacc") or not naam:
                        naam = "Betaalrekening"
                    if iban or naam:
                        conn.execute(
                            "UPDATE accounts SET name = ?, iban = ? WHERE id = ?",
                            (naam or account["name"], iban or account["iban"], account["id"]),
                        )
                        conn.commit()
                except Exception:
                    pass

            try:
                balances = client.get_balances(uid)
                # None = niets opgehaald; dan blijft de laatste bekende stand staan.
                balance = None
                if balances:
                    for b in balances:
                        bal_amount = b.get("balance_amount", {})
                        if bal_amount and bal_amount.get("amount"):
                            try:
                                balance = float(bal_amount["amount"])
                                break
                            except (ValueError, TypeError):
                                continue

                # Fetch transactions: vanaf het vroegst mogelijke moment, zodat de
                # opgetelde historiek bij nul begint. Banken kunnen een te vroege
                # date_from weigeren (ASPSP_ERROR); dan schuift de sync op naar de
                # eerstvolgende datum die de bank wél accepteert.
                db_oudste = conn.execute(
                    "SELECT MIN(booking_date) FROM transactions WHERE account_id = ?",
                    (account["id"],),
                ).fetchone()[0]
                bekend = [d for d in (account["history_from"], db_oudste) if d]
                oudste_bekend = min(bekend) if bekend else None

                ondergrens = None
                if oudste_bekend:
                    try:
                        ondergrens = datetime.strptime(
                            str(oudste_bekend)[:10], "%Y-%m-%d"
                        ).date() - timedelta(days=1)
                    except (ValueError, TypeError):
                        ondergrens = None

                candidates = history_candidates(
                    start=history_start(oudste_bekend), cap=ondergrens
                )
                tx_list = []
                gekozen = ""
                for date_from in candidates:
                    gelukt = False
                    for poging in range(3):
                        try:
                            fetched = client.get_all_transactions(uid, date_from=date_from)
                        except requests.HTTPError as e:
                            code = getattr(getattr(e, "response", None), "status_code", None)
                            if code == 429 and poging < 2:
                                # Rate limit is geen weigering: wachten en dezelfde
                                # datum opnieuw. Opschuiven zou een gat opleveren.
                                time.sleep(20)
                                continue
                            break  # echte weigering (ASPSP_ERROR) -> volgende datum
                        tx_list = fetched or []
                        gelukt = True
                        break
                    if gelukt:
                        # Onthouden welke datum de bank accepteerde (zichtbaar in het
                        # sync-rapport), zodat na te gaan is hoever we terugkwamen.
                        gekozen = date_from
                        melding["history_from_used"] = date_from
                        break

                for tx in tx_list:
                    tx_id = tx.get("entry_reference") or tx.get("transactionId") or tx.get("id", "")
                    if not tx_id:
                        continue

                    amount = 0
                    tx_amount = tx.get("transaction_amount", {})
                    if isinstance(tx_amount, dict):
                        try:
                            amount = float(tx_amount.get("amount", 0) or 0)
                        except (ValueError, TypeError):
                            amount = 0
                    elif isinstance(tx_amount, (int, float)):
                        amount = float(tx_amount)

                    cdi = tx.get("credit_debit_indicator", "")
                    if cdi == "DBIT":
                        amount = -abs(amount)
                    elif cdi == "CRDT":
                        amount = abs(amount)

                    # De vrije betaaltekst. Rabobank stuurt hem in
                    # `remittance_information` (een lijst); de oude veldnamen
                    # blijven als terugval staan voor andere banken.
                    remittance = _tekst(tx.get("remittance_information")) or _tekst(
                        tx.get("remittance_information_unstructured")
                        or tx.get("remittanceInformationUnstructured")
                        or tx.get("additional_information")
                    )

                    creditor = tx.get("creditor", {}) or {}
                    merchant = creditor.get("name", "") if isinstance(creditor, dict) else ""

                    debtor = tx.get("debtor", {}) or {}
                    debtor_name = debtor.get("name", "") if isinstance(debtor, dict) else ""

                    counterparty = merchant or debtor_name or remittance

                    booking_date = tx.get("booking_date") or tx.get("bookingDate") or tx.get("value_date", "")
                    value_date = _tekst(tx.get("value_date") or tx.get("valueDate"))[:10]
                    category = categorize(
                        counterparty,
                        remittance,
                        amount=amount,
                        counterparty_iban=_iban_van_tegenpartij(tx, cdi),
                        learned=learned,
                    )

                    conn.execute(
                        """INSERT OR REPLACE INTO transactions
                           (id, account_id, amount, currency, description, booking_date,
                            merchant_name, category, running_balance, counterparty_iban,
                            value_date, status, type_code, type_sub_code, type_description,
                            remittance, reference_number, reference_number_schema, raw_json)
                           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                        (
                            tx_id,
                            account["id"],
                            amount,
                            account["currency"],
                            counterparty or remittance,
                            booking_date[:10] if booking_date else "",
                            counterparty,
                            category,
                            None,
                            _iban_van_tegenpartij(tx, cdi),
                            value_date,
                            _tekst(tx.get("status")),
                            _code(tx, "code"),
                            _code(tx, "sub_code"),
                            _code(tx, "description"),
                            remittance,
                            _tekst(tx.get("reference_number")),
                            _tekst(tx.get("reference_number_schema")),
                            json.dumps(tx, ensure_ascii=False, sort_keys=True),
                        ),
                    )
                    synced_count += 1
                    melding["transactions"] += 1

                # Hoe ver terug gaat de historiek? Alleen naar voren bijwerken:
                # wat we ooit gezien hebben raken we niet kwijt.
                vroegst = conn.execute(
                    "SELECT MIN(booking_date) FROM transactions WHERE account_id = ?",
                    (account["id"],),
                ).fetchone()[0]
                if vroegst:
                    conn.execute(
                        """UPDATE accounts SET history_from = CASE
                               WHEN history_from IS NULL OR history_from = '' THEN ?
                               WHEN ? < history_from THEN ?
                               ELSE history_from END
                           WHERE id = ?""",
                        (vroegst, vroegst, vroegst, account["id"]),
                    )

                if balance is not None:
                    conn.execute(
                        "UPDATE accounts SET balance = ?, last_synced = datetime('now') WHERE id = ?",
                        (balance, account["id"]),
                    )
                conn.commit()
            except Exception:
                continue

        rapport.append(melding)

    # De historiek mag alleen groeien: nooit stilzwijgend minder worden.
    na = conn.execute("SELECT COUNT(*) FROM transactions").fetchone()[0]
    conn.close()
    return {
        "synced": synced_count,
        "transactions_before": vooraf,
        "transactions_now": na,
        "transactions_lost": max(0, vooraf - na),
        "connections": rapport,
    }
