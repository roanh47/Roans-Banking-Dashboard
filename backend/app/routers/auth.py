from fastapi import APIRouter, Request
from fastapi.responses import RedirectResponse
from app.enable_banking import EnableBankingClient
from app.database import get_db

router = APIRouter(prefix="/api/auth", tags=["auth"])


@router.get("/banks")
def list_banks():
    """Get supported banks for the user to choose from."""
    client = EnableBankingClient()
    try:
        banks = client.list_banks()
        return {"banks": banks.get("aspsps", banks) if isinstance(banks, dict) else banks}
    except Exception as e:
        return {"error": str(e)}


@router.get("/connect/{bank_id}")
def connect_bank(bank_id: str, request: Request, name: str = None, country: str = None):
    """Redirect user to their bank's login page."""
    client = EnableBankingClient()

    # Detect the public-facing URL (works behind Cloudflare/nginx)
    scheme = request.headers.get("X-Forwarded-Proto", request.url.scheme)
    host = request.headers["host"]
    redirect_uri = f"{scheme}://{host}/api/auth/callback"

    result = client.initiate_auth(
        name or bank_id,
        country or "",
        redirect_uri,
    )
    auth_url = result.get("url") or result.get("redirect_url")
    state = result.get("state")

    # Store pending connection so we can match the callback
    conn = get_db()
    conn.execute(
        "INSERT OR REPLACE INTO pending_connections (state, bank_name, bank_country, aspsp_name) VALUES (?, ?, ?, ?)",
        (state, name or bank_id, country or "", name or bank_id),
    )
    conn.commit()
    conn.close()

    return RedirectResponse(url=auth_url)


@router.get("/callback")
def auth_callback(request: Request, code: str = None, state: str = None, error: str = None):
    """Handle the OAuth callback from the bank via Enable Banking.

    Flow: Exchange code for session, store session_id + accounts.
    """
    if error:
        return RedirectResponse(url=f"/?error={error}")

    if not code:
        return RedirectResponse(url="/?error=missing_code")

    conn = get_db()

    # Look up the pending connection by state
    pending = conn.execute(
        "SELECT * FROM pending_connections WHERE state = ?", (state,)
    ).fetchone()

    bank_name = pending["bank_name"] if pending else "Unknown"
    bank_country = pending["bank_country"] if pending else ""

    # Exchange the code for a session
    try:
        client = EnableBankingClient()
        session_data = client.exchange_code(code)
        session_id = session_data.get("session_id")
        if not session_id:
            raise ValueError("No session_id in response")
    except Exception as e:
        conn.close()
        return RedirectResponse(url=f"/?error=session_exchange_failed")

    # Store the session as a bank connection
    conn.execute(
        "INSERT INTO bank_connections (bank_name, auth_token, expires_at) VALUES (?, ?, datetime('now', '+180 days'))",
        (bank_name, session_id),
    )
    connection_id = conn.execute("SELECT last_insert_rowid()").fetchone()[0]

    # Clean up pending
    if pending:
        conn.execute("DELETE FROM pending_connections WHERE state = ?", (state,))

    # Fetch accounts from session data
    raw_accounts = session_data.get("accounts", [])
    for i, acc in enumerate(raw_accounts):
        if isinstance(acc, dict):
            account_id = acc.get("uid", "") or acc.get("id", "") or acc.get("resource_id", "")
            if not account_id:
                continue
            currency = acc.get("currency", "EUR")
            # Extract IBAN from account_id object
            iban = ""
            acc_id_obj = acc.get("account_id", {}) or {}
            if isinstance(acc_id_obj, dict):
                iban = acc_id_obj.get("iban", "")
            if not iban:
                for entry in acc.get("all_account_ids") or []:
                    if entry.get("scheme_name") == "IBAN":
                        iban = entry.get("identification", "")
                        break
            name = acc.get("name") or acc.get("display_name") or iban or f"Account {i + 1}"
            balance = 0
            balance_obj = acc.get("balance", {}) or {}
            if isinstance(balance_obj, dict):
                try:
                    balance = float(balance_obj.get("amount", 0) or 0)
                except (ValueError, TypeError):
                    balance = 0
        else:
            account_id = str(acc)
            name = f"Account {i + 1}"
            currency = "EUR"
            iban = ""
            balance = 0

        conn.execute(
            """INSERT OR REPLACE INTO accounts
               (id, connection_id, name, iban, currency, balance, account_type, last_synced)
               VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))""",
            (account_id, connection_id, name, iban, currency, balance, "checking"),
        )

    conn.commit()
    conn.close()

    return RedirectResponse(url="/?connected=true")


@router.get("/connections")
def list_connections():
    """List all bank connections with account counts."""
    conn = get_db()
    rows = conn.execute("""
        SELECT bc.id, bc.bank_name, bc.created_at, bc.expires_at,
               COUNT(a.id) as account_count
        FROM bank_connections bc
        LEFT JOIN accounts a ON a.connection_id = bc.id
        GROUP BY bc.id
        ORDER BY bc.created_at DESC
    """).fetchall()
    conn.close()
    return {"connections": [dict(r) for r in rows]}


@router.delete("/connections/{connection_id}")
def delete_connection(connection_id: int):
    """Delete a bank connection and its accounts + transactions."""
    conn = get_db()
    # Delete transactions for all accounts in this connection
    conn.execute("""
        DELETE FROM transactions WHERE account_id IN
        (SELECT id FROM accounts WHERE connection_id = ?)
    """, (connection_id,))
    # Delete accounts
    conn.execute("DELETE FROM accounts WHERE connection_id = ?", (connection_id,))
    # Delete the connection
    conn.execute("DELETE FROM bank_connections WHERE id = ?", (connection_id,))
    conn.commit()
    conn.close()
    return {"deleted": True}
