from fastapi import APIRouter
from app.database import get_db
from app.enable_banking import EnableBankingClient
from datetime import datetime, timedelta

router = APIRouter(prefix="/api", tags=["sync"])


@router.get("/sync")
def sync_all():
    """Sync balances and transactions for all connected bank accounts."""
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

            # Get account details from accounts_data
            accounts_data = session_data.get("accounts_data", []) or []

            for i, acc_id in enumerate(raw_accounts):
                account_id = acc_id if isinstance(acc_id, str) else (acc_id.get("uid") or acc_id.get("id", ""))
                if not account_id:
                    continue

                # Try to get name from accounts_data
                name = f"Account {i + 1}"
                if i < len(accounts_data):
                    ad = accounts_data[i]
                    if isinstance(ad, dict):
                        name = ad.get("name") or ad.get("display_name") or name
                        # IBAN might be in identification hashes — skip, we can't decrypt

                conn.execute(
                    """INSERT OR REPLACE INTO accounts
                       (id, connection_id, name, iban, currency, balance, account_type, last_synced)
                       VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))""",
                    (account_id, bank_conn["id"], name, "", "EUR", 0, "checking"),
                )
        except Exception:
            continue

        # Get all accounts for this connection
        rows = conn.execute(
            "SELECT * FROM accounts WHERE connection_id = ?",
            (bank_conn["id"],),
        ).fetchall()

        # Sync balances + transactions for each account
        for account in rows:
            try:
                # Fetch actual balance from balances endpoint
                balances = client.get_balances(account["id"])
                balance = 0
                if balances:
                    # Use the first balance with actual amount
                    for b in balances:
                        bal_amount = b.get("balance_amount", {})
                        if bal_amount and bal_amount.get("amount"):
                            try:
                                balance = float(bal_amount["amount"])
                                break
                            except (ValueError, TypeError):
                                continue

                # Fetch transactions
                date_from = (datetime.utcnow() - timedelta(days=90)).strftime("%Y-%m-%d")
                tx_data = client.get_transactions(account["id"], date_from=date_from)
                tx_list = tx_data.get("transactions", []) if isinstance(tx_data, dict) else tx_data

                for tx in tx_list:
                    tx_id = tx.get("entry_reference") or tx.get("transactionId") or tx.get("id", "")
                    if not tx_id:
                        continue

                    # Parse amount from nested object
                    amount = 0
                    tx_amount = tx.get("transaction_amount", {})
                    if isinstance(tx_amount, dict):
                        try:
                            amount = float(tx_amount.get("amount", 0) or 0)
                        except (ValueError, TypeError):
                            amount = 0
                    elif isinstance(tx_amount, (int, float)):
                        amount = float(tx_amount)

                    # If positive amount, it's a credit (income)
                    # If debit from our account, negate it
                    cdi = tx.get("credit_debit_indicator", "")
                    if cdi == "DBIT":
                        amount = -abs(amount)
                    elif cdi == "CRDT":
                        amount = abs(amount)

                    # Description / remittance info
                    desc = (
                        tx.get("remittance_information_unstructured")
                        or tx.get("remittanceInformationUnstructured")
                        or tx.get("additional_information")
                        or ""
                    )

                    # Merchant / creditor name
                    creditor = tx.get("creditor", {}) or {}
                    merchant = creditor.get("name", "") if isinstance(creditor, dict) else ""

                    debtor = tx.get("debtor", {}) or {}
                    debtor_name = debtor.get("name", "") if isinstance(debtor, dict) else ""

                    counterparty = merchant or debtor_name or desc

                    # Booking date
                    booking_date = tx.get("booking_date") or tx.get("bookingDate") or tx.get("value_date", "")

                    conn.execute(
                        """INSERT OR REPLACE INTO transactions
                           (id, account_id, amount, currency, description, booking_date, merchant_name, running_balance)
                           VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
                        (
                            tx_id,
                            account["id"],
                            amount,
                            account["currency"],
                            counterparty or desc,
                            booking_date[:10] if booking_date else "",
                            counterparty,
                            None,
                        ),
                    )
                    synced_count += 1

                # Update account balance in DB
                conn.execute(
                    "UPDATE accounts SET balance = ?, last_synced = datetime('now') WHERE id = ?",
                    (balance, account["id"]),
                )

                conn.commit()
            except Exception:
                continue

    conn.close()
    return {"synced": synced_count}
