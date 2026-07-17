from fastapi import APIRouter
from app.database import get_db
from app.categorize import categorize

router = APIRouter(prefix="/api", tags=["categorize"])


@router.post("/recategorize")
def recategorize():
    """Re-categorize all existing transactions based on merchant/description."""
    conn = get_db()
    rows = conn.execute(
        "SELECT id, merchant_name, description FROM transactions"
    ).fetchall()
    updated = 0
    for row in rows:
        cat = categorize(row["merchant_name"] or "", row["description"] or "")
        conn.execute(
            "UPDATE transactions SET category = ? WHERE id = ?",
            (cat, row["id"]),
        )
        updated += 1
    conn.commit()
    conn.close()
    return {"recategorized": updated}
