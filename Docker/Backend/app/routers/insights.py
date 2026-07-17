from fastapi import APIRouter
from app.database import get_db
from datetime import datetime, timedelta

router = APIRouter(prefix="/api/insights", tags=["insights"])


@router.get("/spending")
def spending_insights(days: int = 30):
    """Spending breakdown by category."""
    conn = get_db()
    date_from = (datetime.utcnow() - timedelta(days=days)).strftime("%Y-%m-%d")
    rows = conn.execute(
        """
        SELECT category, SUM(ABS(amount)) as total, COUNT(*) as count
        FROM transactions
        WHERE booking_date >= ? AND amount < 0
        GROUP BY category
        ORDER BY total DESC
        """,
        [date_from],
    ).fetchall()
    conn.close()
    return {"insights": [dict(r) for r in rows]}


@router.get("/monthly")
def monthly_overview():
    """Income and spending per month."""
    conn = get_db()
    rows = conn.execute(
        """
        SELECT strftime('%Y-%m', booking_date) as month,
               SUM(CASE WHEN amount > 0 THEN amount ELSE 0 END) as income,
               SUM(CASE WHEN amount < 0 THEN ABS(amount) ELSE 0 END) as spending
        FROM transactions
        GROUP BY month
        ORDER BY month DESC
        LIMIT 12
        """
    ).fetchall()
    conn.close()
    return {"months": [dict(r) for r in rows]}


@router.get("/top-merchants")
def top_merchants(days: int = 30, limit: int = 10):
    """Top merchants by spending."""
    conn = get_db()
    date_from = (datetime.utcnow() - timedelta(days=days)).strftime("%Y-%m-%d")
    rows = conn.execute(
        """
        SELECT COALESCE(merchant_name, description) as merchant,
               SUM(ABS(amount)) as total,
               COUNT(*) as count
        FROM transactions
        WHERE booking_date >= ? AND amount < 0 AND merchant_name IS NOT NULL
        GROUP BY merchant
        ORDER BY total DESC
        LIMIT ?
        """,
        [date_from, limit],
    ).fetchall()
    conn.close()
    return {"merchants": [dict(r) for r in rows]}
