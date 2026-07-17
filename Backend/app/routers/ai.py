from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional
from app.database import get_db
import requests, json

router = APIRouter(prefix="/api/ai", tags=["ai"])


# ── Settings (stored in DB) ──────────────────────────────────────────────

def _ensure_settings_table():
    conn = get_db()
    conn.execute("""
        CREATE TABLE IF NOT EXISTS ai_settings (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL
        )
    """)
    # Defaults
    defaults = {
        "location": "sidebar",
        "endpoint": "",
        "api_key": "",
        "model": "",
    }
    for k, v in defaults.items():
        conn.execute(
            "INSERT OR IGNORE INTO ai_settings (key, value) VALUES (?, ?)",
            (k, v),
        )
    conn.commit()
    conn.close()


@router.get("/settings")
def get_settings():
    _ensure_settings_table()
    conn = get_db()
    rows = conn.execute("SELECT key, value FROM ai_settings").fetchall()
    conn.close()
    return {r["key"]: r["value"] for r in rows}


class SettingsUpdate(BaseModel):
    location: Optional[str] = None
    endpoint: Optional[str] = None
    api_key: Optional[str] = None
    model: Optional[str] = None


@router.put("/settings")
def update_settings(req: SettingsUpdate):
    _ensure_settings_table()
    conn = get_db()
    updates = {k: v for k, v in req.model_dump().items() if v is not None}
    for k, v in updates.items():
        conn.execute(
            "INSERT OR REPLACE INTO ai_settings (key, value) VALUES (?, ?)",
            (k, v),
        )
    conn.commit()
    conn.close()
    return {"ok": True}


@router.get("/models")
def list_ai_models():
    """Fetch models from the user-configured AI endpoint."""
    _ensure_settings_table()
    conn = get_db()
    row_ep = conn.execute("SELECT value FROM ai_settings WHERE key='endpoint'").fetchone()
    row_key = conn.execute("SELECT value FROM ai_settings WHERE key='api_key'").fetchone()
    conn.close()

    endpoint = (row_ep["value"] if row_ep else "").strip()
    api_key = (row_key["value"] if row_key else "").strip()

    if not endpoint:
        return {"models": []}

    try:
        resp = requests.get(
            f"{endpoint.rstrip('/')}/models",
            headers={"Authorization": f"Bearer {api_key}"} if api_key else {},
            timeout=15,
        )
        resp.raise_for_status()
        data = resp.json()
        models = data.get("data", data) if isinstance(data, dict) else data
        if models and isinstance(models, list):
            ids = [m["id"] for m in models if isinstance(m, dict) and m.get("id")]
            return {"models": ids}
        return {"models": []}
    except Exception:
        return {"models": []}


# ── AI Categorization ────────────────────────────────────────────────────

class CategorizeRequest(BaseModel):
    model: str = ""


def _get_ai_credentials():
    conn = get_db()
    ep = conn.execute("SELECT value FROM ai_settings WHERE key='endpoint'").fetchone()
    key = conn.execute("SELECT value FROM ai_settings WHERE key='api_key'").fetchone()
    conn.close()
    return (ep["value"].strip() if ep else ""), (key["value"].strip() if key else "")


def _model_uses_messages_api(model_id: str) -> bool:
    prefix = model_id.split("-")[0].lower() if "-" in model_id else model_id.lower()
    return prefix in ("minimax", "qwen")


def _call_llm(endpoint: str, api_key: str, model: str, system: str, user: str) -> str:
    if _model_uses_messages_api(model):
        resp = requests.post(
            f"{endpoint.rstrip('/')}/messages",
            headers={
                "x-api-key": api_key,
                "Content-Type": "application/json",
                "anthropic-version": "2023-06-01",
            },
            json={
                "model": model,
                "system": system,
                "messages": [{"role": "user", "content": user}],
                "max_tokens": 2048,
                "temperature": 0.1,
            },
            timeout=60,
        )
        resp.raise_for_status()
        data = resp.json()
        blocks = data.get("content", [])
        texts = [b["text"] for b in blocks if isinstance(b, dict) and b.get("type") == "text"]
        return "\n".join(texts)
    else:
        resp = requests.post(
            f"{endpoint.rstrip('/')}/chat/completions",
            headers={
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json",
            },
            json={
                "model": model,
                "messages": [
                    {"role": "system", "content": system},
                    {"role": "user", "content": user},
                ],
                "temperature": 0.1,
                "max_tokens": 2048,
            },
            timeout=60,
        )
        resp.raise_for_status()
        return resp.json()["choices"][0]["message"]["content"]


@router.post("/categorize")
def ai_categorize(req: CategorizeRequest):
    """Use the configured LLM to suggest categories for transactions.
    Returns suggestions for the user to review — does NOT auto-apply."""

    endpoint, api_key = _get_ai_credentials()
    if not endpoint or not api_key:
        raise HTTPException(status_code=400, detail="AI not configured. Go to AI Settings to set your endpoint and API key.")

    model = req.model
    if not model:
        conn = get_db()
        row = conn.execute("SELECT value FROM ai_settings WHERE key='model'").fetchone()
        conn.close()
        model = row["value"] if row else ""
    if not model:
        raise HTTPException(status_code=400, detail="No model selected. Pick one in AI Settings or from the dropdown.")

    # Get existing categories from DB
    conn = get_db()
    existing_cats = conn.execute(
        "SELECT DISTINCT category FROM transactions WHERE category IS NOT NULL AND category != '' ORDER BY category"
    ).fetchall()
    existing_categories = [r["category"] for r in existing_cats]

    # Get transactions (limit to 100 most recent)
    txns = conn.execute(
        "SELECT id, description, merchant_name, amount, category, booking_date FROM transactions ORDER BY booking_date DESC LIMIT 100"
    ).fetchall()
    conn.close()

    if not txns:
        return {"suggestions": [], "existing_categories": existing_categories}

    # Build the prompt
    txn_list = []
    for t in txns:
        desc = t["merchant_name"] or t["description"] or "Unknown"
        amt = t["amount"]
        txn_list.append(f"ID:{t['id']} | {desc} | €{amt} | current:{t['category'] or 'other'}")

    system = (
        "You are a transaction categorizer for a Dutch banking dashboard. "
        "Given a list of transactions, suggest the best category for each one.\n\n"
        f"EXISTING CATEGORIES: {', '.join(existing_categories) if existing_categories else 'none yet'}\n\n"
        "You MUST:\n"
        "1. Use existing categories when they fit.\n"
        "2. You may suggest NEW categories if none of the existing ones fit well.\n"
        "3. Common categories: food, dining, transport, shopping, housing, entertainment, health, subscriptions, income, transfer, other.\n"
        "4. Respond ONLY with valid JSON — an array of objects.\n\n"
        'Format: [{"id":"<transaction_id>","category":"<category>","new":false}]\n'
        'Set "new":true only if the category does NOT exist in the existing list.\n'
        "Do NOT include any explanation, just the JSON array."
    )

    user_msg = "Categorize these transactions:\n\n" + "\n".join(txn_list)

    try:
        raw = _call_llm(endpoint, api_key, model, system, user_msg)
        # Extract JSON from possible markdown code blocks
        cleaned = raw.strip()
        if cleaned.startswith("```"):
            cleaned = cleaned.split("\n", 1)[1] if "\n" in cleaned else cleaned[3:]
            if cleaned.endswith("```"):
                cleaned = cleaned[:-3]
            cleaned = cleaned.strip()

        suggestions = json.loads(cleaned)
        if not isinstance(suggestions, list):
            raise ValueError("Expected array")

        # Build lookup for current categories
        current = {t["id"]: (t["category"] or "other") for t in txns}
        txn_desc = {}
        for t in txns:
            txn_desc[t["id"]] = {
                "description": t["merchant_name"] or t["description"] or "Unknown",
                "amount": t["amount"],
                "booking_date": t["booking_date"] or "",
            }

        result = []
        for s in suggestions:
            sid = s.get("id", "")
            if sid in txn_desc:
                info = txn_desc[sid]
                result.append({
                    "id": sid,
                    "description": info["description"],
                    "amount": info["amount"],
                    "booking_date": info["booking_date"],
                    "current_category": current.get(sid, "other"),
                    "suggested_category": s.get("category", "other"),
                    "is_new_category": s.get("new", False),
                })

        # Collect all unique suggested categories
        all_cats = list(set(
            existing_categories + [s["suggested_category"] for s in result]
        ))
        all_cats.sort()

        return {
            "suggestions": result,
            "existing_categories": existing_categories,
            "all_categories": all_cats,
        }

    except requests.exceptions.RequestException as e:
        raise HTTPException(status_code=502, detail=f"LLM API error: {str(e)}")
    except (json.JSONDecodeError, ValueError, KeyError) as e:
        raise HTTPException(status_code=502, detail=f"Failed to parse LLM response: {str(e)}")


class ApplyRequest(BaseModel):
    updates: list  # [{"id": "...", "category": "..."}]


@router.post("/apply-categories")
def apply_categories(req: ApplyRequest):
    """Apply user-approved category changes to the DB."""
    conn = get_db()
    updated = 0
    for item in req.updates:
        tx_id = item.get("id")
        cat = item.get("category")
        if tx_id and cat:
            conn.execute(
                "UPDATE transactions SET category = ? WHERE id = ?",
                (cat, tx_id),
            )
            updated += 1
    conn.commit()
    conn.close()
    return {"updated": updated}
