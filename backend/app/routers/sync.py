from fastapi import APIRouter
from app.database import get_db
from app.enable_banking import EnableBankingClient
from datetime import datetime, timedelta

router = APIRouter(prefix="/api", tags=["sync"])


@router.get("/sync")
def sync_all():
    """Sync transactions for all connected bank accounts."""
    conn = get_db()
    connections = conn.execute("SELECT * FROM bank_connections").fetchall()
    synced_count = 0

    for bank_conn in connections:
        client = EnableBankingClient()
        session_id = bank_conn["auth_token"]

        # Refresh accounts from the session
        try:
            session_data = client.get_session(session_id)
            raw_accounts = session_data.get("accounts", [])
            for acc in raw_accounts:
                if isinstance(acc, dict):
                    account_id = acc.get("uid", "") or acc.get("id", "")
                    if not account_id:
                        continue
                    currency = acc.get("currency", "EUR")
                    iban = ""
                    acc_id_obj = acc.get("account_id", {}) or {}
                    if isinstance(acc_id_obj, dict):
                        iban = acc_id_obj.get("iban", "")
                    name = acc.get("name") or acc.get("display_name") or iban or account_id
                    balance = 0
                    balance_obj = acc.get("balance", {}) or {}
                    if isinstance(balance_obj, dict):
                        try:
                            balance = float(balance_obj.get("amount", 0) or 0)
                        except (ValueError, TypeError):
                            balance = 0

                    conn.execute(
                        """INSERT OR REPLACE INTO accounts
                           (id, connection_id, name, iban, currency, balance, account_type, last_synced)
                           VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))""",
                        (account_id, bank_conn["id"], name, iban, currency, balance, "checking"),
                    )
        except Exception:
            continue

        # Get all accounts for this connection
        rows = conn.execute(
            "SELECT * FROM accounts WHERE connection_id = ?",
            (bank_conn["id"],),
        ).fetchall()

        # Sync transactions for each account
        for account in rows:
            try:
                date_from = (datetime.utcnow() - timedelta(days=90)).strftime("%Y-%m-%d")
                tx_data = client.get_transactions(account["id"], date_from=date_from)
                transactions = tx_data.get("transactions", tx_data) if isinstance(tx_data, dict) else tx_data

                for tx in transactions:
                    tx_id = tx.get("id") or tx.get("transaction_id")
                    if not tx_id:
                        continue

                    amount = tx.get("amount", 0) or 0
                    if isinstance(amount, dict):
                        amount = amount.get("amount", 0) or 0
                    try:
                        amount = float(amount)
                    except (ValueError, TypeError):
                        amount = 0

                    conn.execute(
                        """INSERT OR REPLACE INTO transactions
                           (id, account_id, amount, currency, description, booking_date, merchant_name, running_balance)
                           VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
                        (
                            tx_id,
                            account["id"],
                            amount,
                            tx.get("currency", account["currency"]),
                            tx.get("remittanceInformationUnstructured") or tx.get("description", ""),
                            tx.get("bookingDate") or tx.get("booking_date", ""),
                            tx.get("debtorName") or tx.get("merchant_name", ""),
                            None,
                        ),
                    )
                    synced_count += 1

                conn.commit()
            except Exception:
                continue

    conn.close()
    return {"synced": synced_count}
