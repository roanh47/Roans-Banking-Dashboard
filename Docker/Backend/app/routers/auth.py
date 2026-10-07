from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import RedirectResponse
from app.enable_banking import EnableBankingClient
from app.database import get_db

import uuid

router = APIRouter(prefix="/api/auth", tags=["auth"])


def parse_account(acc, i: int) -> dict:
    """Haal uid, naam, IBAN en saldo uit een rekening uit de sessie."""
    if not isinstance(acc, dict):
        return {"uid": str(acc), "name": f"Account {i + 1}", "currency": "EUR",
                "iban": "", "balance": 0.0, "kind": "checking"}

    uid = acc.get("uid") or acc.get("id") or acc.get("resource_id") or ""
    iban = ""
    acc_id_obj = acc.get("account_id") or {}
    if isinstance(acc_id_obj, dict):
        iban = acc_id_obj.get("iban") or ""
    if not iban:
        for entry in acc.get("all_account_ids") or []:
            if entry.get("scheme_name") == "IBAN":
                iban = entry.get("identification") or ""
                break

    balance = None
    balance_obj = acc.get("balance") or {}
    if isinstance(balance_obj, dict) and balance_obj.get("amount") is not None:
        try:
            balance = float(balance_obj["amount"])
        except (ValueError, TypeError):
            balance = None

    return {
        "uid": uid,
        # De sessie van de bank levert geen rekeningnaam; alleen een uid. Zonder
        # naam tonen we "Betaalrekening" in plaats van "Account 1".
        "name": acc.get("name") or acc.get("display_name") or iban or "Betaalrekening",
        "currency": acc.get("currency") or "EUR",
        "iban": iban,
        "balance": balance,
        "kind": acc.get("cash_account_type") or acc.get("account_type") or "checking",
    }


def session_validity(session_data: dict) -> tuple:
    """Status en geldigheidsdatum zoals de bank ze teruggeeft."""
    status = session_data.get("status") or ""
    access = session_data.get("access") or {}
    valid_until = access.get("valid_until") or ""
    return status, valid_until


def store_accounts(conn, connection_id: int, raw_accounts: list) -> list:
    """Rekeningen van een sessie opslaan zonder de historiek te breken.

    Het lokale id blijft staan, de uid van de bank gaat naar provider_uid. Zo
    blijven transacties aan dezelfde rekening hangen als je opnieuw koppelt en de
    bank een nieuwe uid uitgeeft.
    """
    opgeslagen = []
    for i, acc in enumerate(raw_accounts):
        gegevens = parse_account(acc, i)
        if not gegevens["uid"]:
            continue

        bestaand = conn.execute(
            """SELECT * FROM accounts WHERE connection_id = ?
               AND (provider_uid = ? OR id = ? OR (iban <> '' AND iban = ?) OR name = ?)
               LIMIT 1""",
            (connection_id, gegevens["uid"], gegevens["uid"], gegevens["iban"], gegevens["name"]),
        ).fetchone()

        if not bestaand:
            # Erfenis: de oude rij had nog geen IBAN en geen provider_uid. Als er
            # precies één rekening is die nergens aan te koppelen valt, is dat hem.
            kandidaten = conn.execute(
                """SELECT * FROM accounts WHERE connection_id = ?
                   AND (iban IS NULL OR iban = '') ORDER BY last_synced LIMIT 2""",
                (connection_id,),
            ).fetchall()
            if len(kandidaten) == 1:
                bestaand = kandidaten[0]

        if bestaand:
            # Een naam die al goed staat niet overschrijven met de plaatsvervanger
            # uit de sessie ("Account 1"), anders heet de rekening na elke sync weer
            # anders.
            nieuwe_naam = gegevens["name"]
            if (bestaand["name"] or "").strip() and nieuwe_naam.startswith("Account "):
                nieuwe_naam = bestaand["name"]
            conn.execute(
                """UPDATE accounts SET provider_uid = ?, name = ?, iban = ?, currency = ?,
                   balance = ?, kind = ?, last_synced = datetime('now') WHERE id = ?""",
                (gegevens["uid"], nieuwe_naam, gegevens["iban"] or bestaand["iban"],
                 gegevens["currency"],
                 gegevens["balance"] if gegevens["balance"] is not None else bestaand["balance"],
                 gegevens["kind"], bestaand["id"]),
            )
            opgeslagen.append(bestaand["id"])
        else:
            lokaal_id = f"acc-{uuid.uuid4().hex[:12]}"
            conn.execute(
                """INSERT INTO accounts (id, connection_id, provider_uid, name, iban, currency,
                   balance, account_type, kind, last_synced)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))""",
                (lokaal_id, connection_id, gegevens["uid"], gegevens["name"], gegevens["iban"],
                 gegevens["currency"], gegevens["balance"] or 0.0, gegevens["kind"], gegevens["kind"]),
            )
            opgeslagen.append(lokaal_id)
    return opgeslagen


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
        """INSERT OR REPLACE INTO pending_connections
           (state, bank_name, bank_country, aspsp_name, reconnect_id)
           VALUES (?, ?, ?, ?, NULL)""",
        (state, name or bank_id, country or "", name or bank_id),
    )
    conn.execute("DELETE FROM pending_connections WHERE created_at < datetime('now', '-1 day')")
    conn.commit()
    conn.close()

    return RedirectResponse(url=auth_url or "/")


@router.get("/reconnect/{connection_id}")
def reconnect_bank(connection_id: int, request: Request, name: str | None = None, country: str | None = None):
    """Opnieuw koppelen: dezelfde bank, een verse sessie, dezelfde rekeningrijen."""
    conn = get_db()
    rij = conn.execute("SELECT * FROM bank_connections WHERE id = ?", (connection_id,)).fetchone()
    if not rij:
        conn.close()
        raise HTTPException(status_code=404, detail="Unknown connection")

    bank_naam = name or rij["bank_name"]
    bank_land = country or rij["bank_country"] or ""
    if not bank_land:
        vorige = conn.execute(
            "SELECT bank_country FROM pending_connections WHERE bank_name = ? AND bank_country <> '' ORDER BY created_at DESC LIMIT 1",
            (bank_naam,),
        ).fetchone()
        bank_land = vorige["bank_country"] if vorige else ""
    conn.close()

    if not bank_land:
        raise HTTPException(
            status_code=400,
            detail="Bank country unknown; reconnect via Connect Bank",
        )

    scheme = request.headers.get("X-Forwarded-Proto", request.url.scheme)
    host = request.headers["host"]
    redirect_uri = f"{scheme}://{host}/api/auth/callback"

    client = EnableBankingClient()
    result = client.initiate_auth(bank_naam, bank_land, redirect_uri)
    auth_url = result.get("url") or result.get("redirect_url")
    state = result.get("state")

    conn = get_db()
    conn.execute(
        """INSERT OR REPLACE INTO pending_connections
           (state, bank_name, bank_country, aspsp_name, reconnect_id)
           VALUES (?, ?, ?, ?, ?)""",
        (state, bank_naam, bank_land, bank_naam, connection_id),
    )
    conn.commit()
    conn.close()

    return RedirectResponse(url=auth_url)


@router.get("/callback")
def auth_callback(request: Request, code: str = None, state: str = None, error: str = None):
    """Handle the OAuth callback from the bank via Enable Banking."""
    if error:
        return RedirectResponse(url=f"/?error={error}")

    if not code:
        return RedirectResponse(url="/?error=missing_code")

    conn = get_db()

    pending = conn.execute(
        "SELECT * FROM pending_connections WHERE state = ?", (state,)
    ).fetchone()

    bank_name = pending["bank_name"] if pending else "Unknown"
    bank_country = pending["bank_country"] if pending else ""
    reconnect_id = pending["reconnect_id"] if pending else None

    try:
        client = EnableBankingClient()
        session_data = client.exchange_code(code)
        session_id = session_data.get("session_id")
        if not session_id:
            raise ValueError("No session_id in response")
    except Exception:
        conn.close()
        return RedirectResponse(url="/?error=session_exchange_failed")

    status, valid_until = session_validity(session_data)

    if reconnect_id:
        # Bestaande koppeling vernieuwen: auth_token en geldigheid vervangen.
        conn.execute(
            """UPDATE bank_connections SET auth_token = ?, status = ?, valid_until = ?,
               last_checked = datetime('now'), last_error = NULL, renewed_at = datetime('now'),
               bank_country = COALESCE(NULLIF(?, ''), bank_country) WHERE id = ?""",
            (session_id, status, valid_until, bank_country, reconnect_id),
        )
        connection_id = reconnect_id
    else:
        conn.execute(
            """INSERT INTO bank_connections (bank_name, auth_token, expires_at, status,
               valid_until, bank_country, last_checked)
               VALUES (?, ?, datetime('now', '+180 days'), ?, ?, ?, datetime('now'))""",
            (bank_name, session_id, status, valid_until, bank_country),
        )
        connection_id = conn.execute("SELECT last_insert_rowid()").fetchone()[0]

    if pending:
        conn.execute("DELETE FROM pending_connections WHERE state = ?", (state,))

    store_accounts(conn, connection_id, session_data.get("accounts") or [])

    conn.commit()
    conn.close()

    if reconnect_id:
        return RedirectResponse(url="/?connected=true&reconnected=true")
    return RedirectResponse(url="/?connected=true")


@router.get("/connections")
def list_connections():
    """List all bank connections with account counts."""
    conn = get_db()
    rows = conn.execute("""
        SELECT bc.id, bc.bank_name, bc.created_at, bc.renewed_at, bc.expires_at,
               bc.status, bc.valid_until, bc.last_checked, bc.last_error,
               COUNT(a.id) as account_count
        FROM bank_connections bc
        LEFT JOIN accounts a ON a.connection_id = bc.id
        GROUP BY bc.id
        ORDER BY bc.created_at DESC
    """).fetchall()
    conn.close()
    return {"connections": [dict(r) for r in rows]}


@router.delete("/connections/{connection_id}")
def disconnect_bank(connection_id: int, purge: bool = False):
    """Koppel een bank los zonder de historiek weg te gooien.

    Transacties zijn het enige dat niet opnieuw op te halen is: de bank gaat maar
    een beperkt aantal jaar terug. Daarom blijft alles staan en gaat de verbinding
    alleen op 'REMOVED'. Alleen met ?purge=1 verdwijnt de historiek echt.
    """
    conn = get_db()
    aantal = conn.execute(
        """SELECT COUNT(*) FROM transactions WHERE account_id IN
           (SELECT id FROM accounts WHERE connection_id = ?)""",
        (connection_id,),
    ).fetchone()[0]
    if purge:
        conn.execute("""
            DELETE FROM transactions WHERE account_id IN
            (SELECT id FROM accounts WHERE connection_id = ?)
        """, (connection_id,))
        conn.execute("DELETE FROM accounts WHERE connection_id = ?", (connection_id,))
        conn.execute("DELETE FROM bank_connections WHERE id = ?", (connection_id,))
    else:
        conn.execute(
            "UPDATE bank_connections SET status = 'REMOVED', removed_at = datetime('now') WHERE id = ?",
            (connection_id,),
        )
    conn.commit()
    conn.close()
    return {"ok": True, "purged": bool(purge), "transactions_kept": 0 if purge else aantal}
