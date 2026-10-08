from fastapi import APIRouter

from app.categorize import categorize, learned_map
from app.database import get_db

router = APIRouter(prefix="/api", tags=["categorize"])


@router.post("/recategorize")
def recategorize():
    """Zet alle bestaande boekingen opnieuw in een categorie.

    Zelfde motor als bij een sync: eigen overboekingen en inkomen eerst, dan de
    trefwoordentabel, dan wat je eerder met deze tegenpartij deed.
    """
    conn = get_db()
    learned = learned_map(conn)
    rows = conn.execute(
        """SELECT id, merchant_name, description, amount, counterparty_iban
           FROM transactions"""
    ).fetchall()

    per_categorie: dict[str, int] = {}
    veranderd = 0
    for row in rows:
        cat = categorize(
            row["merchant_name"] or "",
            row["description"] or "",
            amount=row["amount"],
            counterparty_iban=row["counterparty_iban"] or "",
            learned=learned,
        )
        per_categorie[cat] = per_categorie.get(cat, 0) + 1
        cursor = conn.execute(
            "UPDATE transactions SET category = ? WHERE id = ? AND COALESCE(category, '') <> ?",
            (cat, row["id"], cat),
        )
        veranderd += cursor.rowcount or 0

    conn.commit()
    conn.close()
    return {
        "recategorized": len(rows),
        "changed": veranderd,
        "learned_payees": len(learned),
        "per_category": dict(sorted(per_categorie.items(), key=lambda kv: -kv[1])),
    }
