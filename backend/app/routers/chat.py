from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from app.config import settings
from app.database import get_db
import requests, json

router = APIRouter(prefix="/api/chat", tags=["chat"])


class ChatRequest(BaseModel):
    message: str
    model: str = ""


@router.get("/models")
def list_models():
    """Fetch available models from the OpenAI-compatible API."""
    if not settings.openai_api_key or not settings.openai_base_url:
        return {"models": []}
    try:
        resp = requests.get(
            f"{settings.openai_base_url.rstrip('/')}/models",
            headers={"Authorization": f"Bearer {settings.openai_api_key}"},
            timeout=15,
        )
        resp.raise_for_status()
        data = resp.json()
        models = data.get("data", data) if isinstance(data, dict) else data
        # Extract model IDs
        if models and isinstance(models, list):
            ids = [m["id"] for m in models if isinstance(m, dict) and m.get("id")]
            return {"models": ids}
        return {"models": []}
    except Exception:
        return {"models": []}


def _collect_dashboard_context() -> str:
    """Collect all dashboard data into a text summary for the AI."""
    conn = get_db()
    parts = []

    # Accounts
    accounts = conn.execute("SELECT * FROM accounts").fetchall()
    if accounts:
        parts.append("=== ACCOUNTS ===")
        for a in accounts:
            parts.append(f"{a['name']} ({a['currency']}): €{a['balance']}")
    else:
        parts.append("No accounts connected.")

    # Transactions (last 30)
    tx = conn.execute(
        "SELECT * FROM transactions ORDER BY booking_date DESC LIMIT 30"
    ).fetchall()
    if tx:
        parts.append("\n=== RECENT TRANSACTIONS (last 30) ===")
        for t in tx:
            amt = f"+€{t['amount']}" if t['amount'] > 0 else f"-€{abs(t['amount'])}"
            parts.append(f"{t['booking_date']} | {t['description']:40} | {amt}")
    else:
        parts.append("\nNo transactions found.")

    # Monthly spending by category
    spending = conn.execute(
        """SELECT category, SUM(ABS(amount)) as total, COUNT(*) as count
           FROM transactions WHERE amount < 0
           GROUP BY category ORDER BY total DESC"""
    ).fetchall()
    if spending:
        parts.append("\n=== SPENDING BY CATEGORY ===")
        for s in spending:
            parts.append(f"{s['category']}: €{s['total']} ({s['count']} txns)")

    # Monthly overview
    monthly = conn.execute(
        """SELECT strftime('%Y-%m', booking_date) as month,
                  SUM(CASE WHEN amount > 0 THEN amount ELSE 0 END) as income,
                  SUM(CASE WHEN amount < 0 THEN ABS(amount) ELSE 0 END) as spending
           FROM transactions GROUP BY month ORDER BY month DESC LIMIT 6"""
    ).fetchall()
    if monthly:
        parts.append("\n=== MONTHLY OVERVIEW ===")
        for m in monthly:
            parts.append(f"{m['month']}: income €{m['income']}, spending €{m['spending']}")

    conn.close()
    return "\n".join(parts)


def _model_uses_messages_api(model_id: str) -> bool:
    """Detect if a model uses the Anthropic Messages API (/messages) or the OpenAI Chat API (/chat/completions)."""
    prefix = model_id.split("-")[0].lower() if "-" in model_id else model_id.lower()
    return prefix in ("minimax", "qwen")


def _call_messages_api(base_url: str, api_key: str, model: str, system_prompt: str, user_msg: str) -> str:
    """Call the Anthropic Messages API format."""
    resp = requests.post(
        f"{base_url.rstrip('/')}/messages",
        headers={
            "x-api-key": api_key,
            "Content-Type": "application/json",
            "anthropic-version": "2023-06-01",
        },
        json={
            "model": model,
            "system": system_prompt,
            "messages": [{"role": "user", "content": user_msg}],
            "max_tokens": 1024,
            "temperature": 0.3,
        },
        timeout=30,
    )
    resp.raise_for_status()
    data = resp.json()
    blocks = data.get("content", [])
    texts = [b["text"] for b in blocks if isinstance(b, dict) and b.get("type") == "text"]
    return "\n".join(texts) if texts else ""


def _call_chat_api(base_url: str, api_key: str, model: str, system_prompt: str, user_msg: str) -> str:
    """Call the OpenAI Chat Completions API format."""
    resp = requests.post(
        f"{base_url.rstrip('/')}/chat/completions",
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        },
        json={
            "model": model,
            "messages": [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_msg},
            ],
            "temperature": 0.3,
            "max_tokens": 1024,
        },
        timeout=30,
    )
    resp.raise_for_status()
    data = resp.json()
    return data["choices"][0]["message"]["content"]


@router.post("")
def chat(req: ChatRequest):
    """Send a message to BankBot. Uses dashboard data as context."""
    if not settings.openai_api_key or not settings.openai_base_url:
        raise HTTPException(status_code=400, detail="BankBot not configured. Set OPENAI_API_KEY and OPENAI_BASE_URL in .env")

    model = req.model or "glm-5.1"

    # Collect dashboard context
    context = _collect_dashboard_context()
    system_prompt = (
        "You are BankBot, a helpful financial assistant for Roan's Banking Dashboard. "
        "You have access to the user's banking data below. Answer questions about their "
        "finances, spending, accounts, and transactions. Be concise and use numbers.\n\n"
        "Current dashboard data:\n"
        f"{context}"
    )

    try:
        if _model_uses_messages_api(model):
            reply = _call_messages_api(
                settings.openai_base_url, settings.openai_api_key,
                model, system_prompt, req.message,
            )
        else:
            reply = _call_chat_api(
                settings.openai_base_url, settings.openai_api_key,
                model, system_prompt, req.message,
            )
        return {"reply": reply}
    except requests.exceptions.RequestException as e:
        raise HTTPException(status_code=502, detail=f"LLM API error: {str(e)}")
    except (KeyError, IndexError, json.JSONDecodeError) as e:
        raise HTTPException(status_code=502, detail=f"Unexpected LLM response: {str(e)}")
