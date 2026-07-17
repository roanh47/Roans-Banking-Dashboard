from fastapi import APIRouter, Query
from app.database import get_db
from datetime import datetime, timedelta

router = APIRouter(prefix="/api/accounts", tags=["accounts"])


@router.get("/banks")
def list_banks_with_accounts():
    """Get all bank connections with their accounts."""
    conn = get_db()
    connections = conn.execute("""
        SELECT bc.id, bc.bank_name, bc.created_at, bc.expires_at
        FROM bank_connections bc
        ORDER BY bc.created_at DESC
    """).fetchall()

    result = []
    for c in connections:
        accounts = conn.execute(
            "SELECT id, name, iban, currency, balance, account_type, last_synced FROM accounts WHERE connection_id = ?",
            (c["id"],),
        ).fetchall()

        total = sum(a["balance"] for a in accounts) if accounts else 0

        result.append({
            "id": c["id"],
            "bank_name": c["bank_name"],
            "created_at": c["created_at"],
            "expires_at": c["expires_at"],
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


@router.get("/summary")
def account_summary():
    """Get account summary for the dashboard (net worth, total balance)."""
    conn = get_db()
    total = conn.execute("SELECT COALESCE(SUM(balance), 0) as total FROM accounts").fetchone()
    count = conn.execute("SELECT COUNT(*) as count FROM accounts").fetchone()
    conn.close()
    return {
        "total_balance": total["total"],
        "account_count": count["count"],
    }
