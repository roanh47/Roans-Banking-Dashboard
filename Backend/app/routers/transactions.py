from fastapi import APIRouter, Query
from app.database import get_db
from datetime import datetime, timedelta

router = APIRouter(prefix="/api/transactions", tags=["transactions"])


@router.get("")
def list_transactions(
    limit: int = Query(50, ge=1, le=500),
    offset: int = Query(0, ge=0),
    days: int = Query(90, ge=1, le=365),
    category: str = None,
):
    """Get transactions with optional filtering."""
    conn = get_db()
    date_from = (datetime.utcnow() - timedelta(days=days)).strftime("%Y-%m-%d")

    query = "SELECT * FROM transactions WHERE booking_date >= ?"
    params = [date_from]

    if category:
        query += " AND category = ?"
        params.append(category)

    query += " ORDER BY booking_date DESC LIMIT ? OFFSET ?"
    params.extend([limit, offset])

    rows = conn.execute(query, params).fetchall()
    conn.close()
    return {"transactions": [dict(r) for r in rows]}
