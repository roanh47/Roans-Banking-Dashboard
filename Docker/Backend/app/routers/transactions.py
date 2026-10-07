from fastapi import APIRouter, Query
from app.database import get_db
from app import derive
from datetime import datetime, timedelta

router = APIRouter(prefix="/api/transactions", tags=["transactions"])


@router.get("")
def list_transactions(
    limit: int = Query(50, ge=1, le=50000),
    offset: int = Query(0, ge=0),
    days: int = Query(0, ge=0, le=3650),
    account_id: str = None,
    account_key: str = None,
    q: str = None,
    category: str = None,
):
    """Transacties, optioneel per rekening.

    De betaalrekening heeft een echt bankafschrift. De spaarrekeningen en IBKR
    niet: die halen we uit Firefly en rekenen we door met de overboekingen die
    op de betaalrekening staan. Voor die rekeningen geven we de gevonden
    overboekingen terug, met een vlag dat het voorspeld is.
    """
    conn = get_db()

    # Een sleutel kan van een echte rekening zijn (dan staat hij in accounts)
    # of van een voorspelde rekening ("firefly:3"). Kijken, niet gokken.
    if account_key and not account_id:
        if conn.execute("SELECT id FROM accounts WHERE id = ?", (account_key,)).fetchone():
            account_id = account_key

    # Afgeleide rekening (key ziet eruit als "firefly:3"); een echte
    # rekening is hierboven al afgevangen.
    if account_key and not account_id:
        for rekening in derive.derived_accounts(conn)["accounts"]:
            if rekening["key"] != account_key:
                continue
            rijen = [
                {
                    "id": f"{rekening['key']}:{m['date']}:{m['amount']}",
                    "booking_date": m["date"],
                    "amount": m["amount"],
                    "currency": "EUR",
                    "description": m["description"],
                    "merchant_name": m.get("matched_by") or "",
                    "category": "transfer",
                    "predicted": True,
                    "voor_ijkpunt": bool(m.get("voor_ijkpunt")),
                    "account_key": rekening["key"],
                    "source_tx_id": m.get("tx_id"),
                    "source_account_id": m.get("account_id"),
                }
                for m in rekening["moves"]
            ]
            rijen.sort(key=lambda r: r["booking_date"], reverse=True)
            conn.close()
            return {
                "account": rekening,
                "transactions": rijen[offset : offset + limit],
                "count": len(rijen),
                "total_in": round(sum(r["amount"] for r in rijen if r["amount"] > 0), 2),
                "total_out": round(sum(r["amount"] for r in rijen if r["amount"] < 0), 2),
                "predicted": True,
            }

    where, params = [], []
    if days:
        where.append("booking_date >= ?")
        params.append((datetime.utcnow() - timedelta(days=days)).strftime("%Y-%m-%d"))
    if account_id:
        where.append("account_id = ?")
        params.append(account_id)
    if category:
        where.append("category = ?")
        params.append(category)
    if q:
        where.append(
            "(LOWER(description) LIKE ? OR LOWER(COALESCE(merchant_name, '')) LIKE ?"
            " OR LOWER(COALESCE(remittance, '')) LIKE ? OR LOWER(COALESCE(counterparty_iban, '')) LIKE ?)"
        )
        like = f"%{q.lower()}%"
        params.extend([like, like, like, like])

    kern = " FROM transactions WHERE " + (" AND ".join(where) if where else "1=1")

    count = conn.execute("SELECT COUNT(*)" + kern, params).fetchone()[0]
    total_in = conn.execute(
        "SELECT COALESCE(SUM(amount), 0)" + kern + " AND amount > 0", params
    ).fetchone()[0]
    total_out = conn.execute(
        "SELECT COALESCE(SUM(amount), 0)" + kern + " AND amount < 0", params
    ).fetchone()[0]
    rows = conn.execute(
        "SELECT *" + kern + " ORDER BY booking_date DESC, id DESC LIMIT ? OFFSET ?",
        params + [limit, offset],
    ).fetchall()

    rekening = None
    if account_id:
        rij = conn.execute("SELECT * FROM accounts WHERE id = ?", (account_id,)).fetchone()
        if rij:
            rekening = dict(rij)

    # Naar welke rekening gaat elke boeking? (spaarrekening, school, IBKR)
    links = derive.links_for(conn, rows) if rows else {}
    conn.close()
    return {
        "account": rekening,
        "transactions": [dict(r) for r in rows],
        "links": links,
        "count": count,
        "total_in": round(total_in, 2),
        "total_out": round(total_out, 2),
        "predicted": False,
    }
