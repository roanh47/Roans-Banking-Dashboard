from fastapi import APIRouter
from app.database import get_db
from app import derive
from app.derive import derived_accounts
from datetime import datetime, timezone

router = APIRouter(prefix="/api/accounts", tags=["accounts"])

# Vanaf hoeveel dagen voor het verlopen waarschuwen we.
WARN_DAYS = 14


def _dagen_tot(datum: str):
    """Dagen tot een datum, of None als er geen datum is."""
    if not datum:
        return None
    tekst = str(datum).replace("Z", "+00:00")
    try:
        moment = datetime.fromisoformat(tekst)
    except ValueError:
        try:
            moment = datetime.fromisoformat(tekst[:10])
        except ValueError:
            return None
    if moment.tzinfo is None:
        moment = moment.replace(tzinfo=timezone.utc)
    return (moment - datetime.now(timezone.utc)).days


def connection_state(status: str, dagen):
    """ok / bijna / verlopen / onbekend."""
    if (status or "").upper() in ("EXPIRED", "REVOKED", "REJECTED", "CLOSED"):
        return "verlopen"
    if dagen is None:
        return "onbekend"
    if dagen < 0:
        return "verlopen"
    if dagen <= WARN_DAYS:
        return "bijna"
    return "ok"


@router.get("/banks")
def list_banks_with_accounts():
    """Get all bank connections with their accounts."""
    conn = get_db()
    connections = conn.execute("""
        SELECT bc.id, bc.bank_name, bc.bank_country, bc.created_at, bc.renewed_at,
               bc.expires_at, bc.status, bc.valid_until, bc.last_checked, bc.last_error
        FROM bank_connections bc
        ORDER BY bc.created_at DESC
    """).fetchall()

    result = []
    for c in connections:
        accounts = conn.execute(
            """SELECT id, provider_uid, name, iban, currency, balance, account_type, kind,
                      last_synced, history_from,
                      (SELECT COUNT(*) FROM transactions t WHERE t.account_id = accounts.id) AS tx_count
               FROM accounts WHERE connection_id = ? ORDER BY balance DESC""",
            (c["id"],),
        ).fetchall()

        total = sum(a["balance"] for a in accounts) if accounts else 0
        geldig_tot = c["valid_until"] or c["expires_at"]
        dagen = _dagen_tot(geldig_tot)
        status = (c["status"] or "").upper()
        if status and status not in ("AUTHORIZED", "PENDING", "RECEIVED"):
            # Een einddatum in de toekomst zegt niets als de sessie niet loopt.
            dagen = None

        result.append({
            "id": c["id"],
            "bank_name": c["bank_name"],
            "bank_country": c["bank_country"],
            "created_at": c["created_at"],
            "renewed_at": c["renewed_at"],
            "expires_at": c["expires_at"],
            "status": c["status"],
            "valid_until": geldig_tot,
            "valid_days_left": dagen,
            "state": connection_state(c["status"], dagen),
            "last_checked": c["last_checked"],
            "last_error": c["last_error"],
            "total_balance": total,
            "accounts": [dict(a) for a in accounts],
        })

    conn.close()
    return {"banks": result}


@router.get("")
def list_accounts():
    """Get all synced bank accounts."""
    conn = get_db()
    rows = conn.execute("SELECT * FROM accounts ORDER BY balance DESC").fetchall()
    conn.close()
    return {"accounts": [dict(r) for r in rows]}


@router.get("/overview")
def accounts_overview():
    """Alle rekeningen op één rij: de betaalrekening(en) van de bank plus de
    rekeningen die we voorspellen (spaar, school, IBKR)."""
    conn = get_db()
    rijen = conn.execute(
        """SELECT id, provider_uid, connection_id, name, iban, currency, balance,
                  account_type, kind, last_synced, history_from,
                  (SELECT COUNT(*) FROM transactions t WHERE t.account_id = accounts.id) AS tx_count,
                  (SELECT MIN(booking_date) FROM transactions t WHERE t.account_id = accounts.id) AS first_tx,
                  (SELECT MAX(booking_date) FROM transactions t WHERE t.account_id = accounts.id) AS last_tx
           FROM accounts ORDER BY balance DESC"""
    ).fetchall()

    uit = []
    for r in rijen:
        d = dict(r)
        d["key"] = str(d["id"])
        d["predicted"] = False
        d["source"] = "bank"
        d["display_number"] = d["iban"] or d["provider_uid"] or ""
        d["overboeking"] = False
        uit.append(d)

    for a in derive.derived_accounts(conn)["accounts"]:
        bewegingen = a["moves"]
        uit.append({
            "key": a["key"],
            "id": None,
            "name": a["name"],
            "iban": a["iban"],
            "display_number": a["iban"] or a["account_number"],
            "provider_uid": a["account_number"],
            "connection_id": None,
            "currency": "EUR",
            "balance": a["balance"],
            "account_type": "savings" if a["kind"] == "savings" else "broker",
            "kind": a["kind"],
            "last_synced": a["updated_at"],
            "history_from": a["baseline_date"],
            "tx_count": len(bewegingen),
            "first_tx": bewegingen[0]["date"] if bewegingen else a["baseline_date"],
            "last_tx": bewegingen[-1]["date"] if bewegingen else a["baseline_date"],
            "predicted": True,
            "source": a["source"],
            "baseline": a["baseline"],
            "baseline_date": a["baseline_date"],
            "delta": a["delta"],
            "overboeking": True,
            # Wat er met vaste regelmaat op deze rekening binnenkomt, en waar je
            # dan over twaalf maanden staat als dat zo doorgaat.
            "statement_rows": a.get("statement_rows"),
            "first_statement_date": a.get("first_statement_date"),
            "recurring": a.get("recurring"),
            "monthly": a.get("monthly"),
            "projection_12m": a.get("projection_12m"),
        })

    conn.close()
    return {"accounts": uit, "total": round(sum(x["balance"] or 0 for x in uit), 2)}


@router.get("/summary")
def account_summary():
    """Get account summary for the dashboard (net worth, total balance)."""
    conn = get_db()
    total = conn.execute("SELECT COALESCE(SUM(balance), 0) as total FROM accounts").fetchone()
    count = conn.execute("SELECT COUNT(*) as count FROM accounts").fetchone()
    extern = derived_accounts(conn)
    conn.close()

    extern_total = round(sum(a["balance"] for a in extern["accounts"]), 2)
    return {
        "total_balance": total["total"],
        "account_count": count["count"],
        "external_balance": extern_total,
        "external_count": len(extern["accounts"]),
        "external_account_count": len(extern["accounts"]),
        "net_worth": round((total["total"] or 0) + extern_total, 2),
    }
