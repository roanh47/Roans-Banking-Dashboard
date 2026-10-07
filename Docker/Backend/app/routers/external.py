"""Rekeningen die niet via PSD2 komen (spaarrekeningen, IBKR).

De bank levert alleen de betaalrekening. De rest komt uit Firefly (het ijkpunt)
en wordt doorgerekend met de interne overboekingen op de betaalrekening. Zie
app/derive.py. De brug op de host duwt de ijkpunten hier naartoe.
"""

from fastapi import APIRouter, Header, HTTPException

from app.config import settings
from app.database import get_db
from app.derive import derived_accounts

router = APIRouter(prefix="/api/external", tags=["external"])


@router.get("/accounts")
def list_external_accounts():
    """Voorspelde saldo's van de rekeningen buiten de consent."""
    return derived_accounts()


@router.post("/accounts")
def push_external_accounts(payload: dict, x_push_token: str = Header(default="")):
    """Ontvangt de ijkpunten van de brug (Firefly). Alleen met de juiste token."""
    if not settings.push_token:
        raise HTTPException(status_code=403, detail="PUSH_TOKEN not set on the server")
    if x_push_token != settings.push_token:
        raise HTTPException(status_code=401, detail="Invalid token")

    bron = payload.get("source") or "firefly"
    rekeningen = payload.get("accounts") or []

    conn = get_db()
    sleutels = []
    for rekening in rekeningen:
        sleutel = rekening.get("key")
        if not sleutel:
            continue
        sleutels.append(sleutel)
        bestaand = conn.execute(
            "SELECT keywords FROM external_accounts WHERE key = ?", (sleutel,)
        ).fetchone()
        trefwoorden = rekening.get("keywords") or (bestaand["keywords"] if bestaand else "")
        if isinstance(trefwoorden, (list, tuple)):
            # De brug stuurt een lijst; in de database bewaren we komma-tekst.
            trefwoorden = ", ".join(str(k).strip().lower() for k in trefwoorden if str(k).strip())
        conn.execute(
            """INSERT INTO external_accounts
               (key, label, kind, iban, account_number, balance, balance_date, keywords, source, active, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, datetime('now'))
               ON CONFLICT(key) DO UPDATE SET
                 active = 1,
                 label = excluded.label,
                 kind = excluded.kind,
                 iban = excluded.iban,
                 account_number = excluded.account_number,
                 balance = excluded.balance,
                 balance_date = excluded.balance_date,
                 keywords = excluded.keywords,
                 source = excluded.source,
                 updated_at = datetime('now')""",
            (
                sleutel,
                rekening.get("label") or sleutel,
                rekening.get("kind") or "savings",
                rekening.get("iban") or "",
                rekening.get("account_number") or "",
                float(rekening.get("balance") or 0.0),
                rekening.get("balance_date") or "",
                trefwoorden,
                bron,
            ),
        )

    # Wat de brug niet meer meldt gaat op non-actief. De rij blijft staan, zodat
    # een rekening die terugkomt meteen weer klopt en er niets verdwijnt.
    if sleutels:
        plekken = ",".join("?" * len(sleutels))
        conn.execute(
            f"UPDATE external_accounts SET active = 0 WHERE source = ? AND key NOT IN ({plekken})",
            (bron, *sleutels),
        )
    else:
        conn.execute("UPDATE external_accounts SET active = 0 WHERE source = ?", (bron,))
    conn.commit()
    conn.close()

    return {"ok": True, "received": len(sleutels), "derived": derived_accounts()}
