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
            inserted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
    """)
    conn.commit()
    conn.close()
