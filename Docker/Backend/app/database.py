import sqlite3
from pathlib import Path

DB_PATH = Path("/app/data/dashboard.db")


def get_db() -> sqlite3.Connection:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(DB_PATH))
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    return conn


def _kolommen(conn: sqlite3.Connection, tabel: str) -> set:
    return {r["name"] for r in conn.execute(f"PRAGMA table_info({tabel})")}


def _voeg_toe(conn: sqlite3.Connection, tabel: str, kolom: str, declaratie: str) -> None:
    """Kolom toevoegen als die nog niet bestaat, zodat een bestaande database meegaat."""
    if kolom not in _kolommen(conn, tabel):
        conn.execute(f"ALTER TABLE {tabel} ADD COLUMN {kolom} {declaratie}")


def init_db():
    conn = get_db()
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS pending_connections (
            state TEXT PRIMARY KEY,
            bank_name TEXT NOT NULL,
            bank_country TEXT,
            aspsp_name TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS bank_connections (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            bank_name TEXT NOT NULL,
            auth_token TEXT NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            expires_at TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS accounts (
            id TEXT PRIMARY KEY,
            connection_id INTEGER REFERENCES bank_connections(id),
            name TEXT NOT NULL,
            iban TEXT,
            currency TEXT DEFAULT 'EUR',
            balance REAL DEFAULT 0,
            account_type TEXT,
            last_synced TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS transactions (
            id TEXT PRIMARY KEY,
            account_id TEXT REFERENCES accounts(id),
            amount REAL NOT NULL,
            currency TEXT DEFAULT 'EUR',
            description TEXT,
            booking_date TEXT,
            category TEXT DEFAULT 'other',
            merchant_name TEXT,
            running_balance REAL,
            value_date TEXT,
            status TEXT,
            type_code TEXT,
            type_sub_code TEXT,
            type_description TEXT,
            remittance TEXT,
            reference_number TEXT,
            reference_number_schema TEXT,
            raw_json TEXT,
            counterparty_iban TEXT,
            inserted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS external_accounts (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            key TEXT UNIQUE NOT NULL,
            label TEXT NOT NULL,
            kind TEXT DEFAULT 'savings',
            iban TEXT,
            account_number TEXT,
            balance REAL DEFAULT 0,
            balance_date TEXT,
            keywords TEXT,
            source TEXT DEFAULT 'manual',
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
    """)

    # Migraties: bestaande databases krijgen de nieuwe kolommen erbij.
    _voeg_toe(conn, "pending_connections", "reconnect_id", "INTEGER")
    _voeg_toe(conn, "bank_connections", "status", "TEXT")
    _voeg_toe(conn, "bank_connections", "valid_until", "TIMESTAMP")
    _voeg_toe(conn, "bank_connections", "last_checked", "TIMESTAMP")
    _voeg_toe(conn, "bank_connections", "last_error", "TEXT")
    _voeg_toe(conn, "bank_connections", "bank_country", "TEXT")
    _voeg_toe(conn, "bank_connections", "renewed_at", "TIMESTAMP")
    _voeg_toe(conn, "accounts", "provider_uid", "TEXT")
    _voeg_toe(conn, "accounts", "history_from", "TEXT")
    _voeg_toe(conn, "bank_connections", "removed_at", "TIMESTAMP")
    _voeg_toe(conn, "external_accounts", "active", "INTEGER DEFAULT 1")
    _voeg_toe(conn, "accounts", "kind", "TEXT DEFAULT 'checking'")
    _voeg_toe(conn, "transactions", "counterparty_iban", "TEXT")
    # Velden die de bank wél stuurt maar die eerder werden weggegooid. Alles wat
    # bij Rabobank standaard leeg is (note, exchange_rate, merchant_category_code,
    # balance_after_transaction, de agent- en adresblokken) laten we eruit.
    _voeg_toe(conn, "transactions", "value_date", "TEXT")
    _voeg_toe(conn, "transactions", "status", "TEXT")
    _voeg_toe(conn, "transactions", "type_code", "TEXT")
    _voeg_toe(conn, "transactions", "type_sub_code", "TEXT")
    _voeg_toe(conn, "transactions", "type_description", "TEXT")
    _voeg_toe(conn, "transactions", "remittance", "TEXT")
    _voeg_toe(conn, "transactions", "reference_number", "TEXT")
    _voeg_toe(conn, "transactions", "reference_number_schema", "TEXT")
    _voeg_toe(conn, "transactions", "raw_json", "TEXT")

    # De id was vroeger de uid van de bank. Die uid hoort in provider_uid: het
    # lokale id blijft staan zodat transacties aan dezelfde rekening blijven hangen
    # als je opnieuw koppelt en de bank een nieuwe uid uitgeeft.
    conn.execute("UPDATE accounts SET provider_uid = id WHERE provider_uid IS NULL OR provider_uid = ''")
    conn.execute("UPDATE accounts SET kind = 'checking' WHERE kind IS NULL OR kind = ''")
    conn.execute("UPDATE bank_connections SET valid_until = expires_at WHERE valid_until IS NULL")
    # Land van de bank overnemen uit een eerdere aanmelding (voor het opnieuw koppelen).
    conn.execute(
        """UPDATE bank_connections SET bank_country = (
               SELECT p.bank_country FROM pending_connections p
               WHERE p.bank_name = bank_connections.bank_name
                 AND p.bank_country IS NOT NULL AND p.bank_country <> ''
               ORDER BY p.rowid DESC LIMIT 1)
           WHERE (bank_country IS NULL OR bank_country = '') AND bank_name IN (
               SELECT DISTINCT bank_name FROM pending_connections WHERE bank_country IS NOT NULL)"""
    )
    # Aanmeldingen die nooit zijn afgerond zijn rommel.
    conn.execute("DELETE FROM pending_connections WHERE state IS NULL OR state = ''")
    conn.execute("DELETE FROM pending_connections WHERE created_at < datetime('now', '-1 day')")
    conn.commit()
    conn.close()
