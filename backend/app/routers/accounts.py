from fastapi import APIRouter, Query
from app.database import get_db
from datetime import datetime, timedelta

router = APIRouter(prefix="/api/accounts", tags=["accounts"])


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
