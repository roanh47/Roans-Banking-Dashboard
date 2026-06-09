# Roan's Banking Dashboard

A self-hosted personal finance dashboard that connects to EU bank accounts via Open Banking (PSD2). Runs in Docker, data stays in your own SQLite database.

## Features

- **Net worth** — combined balance across all linked accounts
- **Spending breakdown** — per-category totals, top merchants, monthly trends
- **Transactions** — searchable list with category filters
- **Bank linking** — OAuth via Enable Banking (Revolut, N26, Rabobank, 800+ EU banks)
- **Sync** — one-click refresh for balances and transactions

## Quick start

```bash
git clone https://github.com/roanh47/Roans-Banking-Dashboard.git
cd Roans-Banking-Dashboard
cp .env.example .env
# Place your .pem key in config/
docker compose up -d --build
```

Opens at **http://localhost:8200**.

## Setup

### 1. Enable Banking application

You need an app registered at [enablebanking.com](https://enablebanking.com):

1. Create an application (Sandbox or Production)
2. Set **Redirect URI** to `http://localhost:8200/api/auth/callback`
3. Download the private key and save it to `config/` (any `.pem` filename works)
4. Copy your **Application ID** from the app detail page

### 2. Configure environment

```bash
cp .env.example .env
```

Edit `.env` and set your Application ID:

```
ENABLE_BANKING_APP_ID=your-uuid-here
```

### 3. Start

```bash
docker compose up -d --build
```

The container finds the first `.pem` file in `config/` automatically. If none exists, it generates one and prints the public certificate to the logs.

### 4. Connect a bank

1. Open http://localhost:8200
2. Go to Connect Bank
3. Pick your bank and authorize via OAuth
4. Your balances appear on the dashboard

Use the Sync now button to pull transactions.

## Configuration

| Variable | Default | Notes |
|----------|---------|-------|
| `APP_PORT` | `8200` | Dashboard port |
| `ENABLE_BANKING_APP_ID` | — | Your Enable Banking app UUID |

### Private key

The entrypoint scans `config/` for `.pem` files on each start. It uses the first match. Place your downloaded key there at any filename. No config needed.

## Security

- `config/*.pem` — RSA private key, never commit (in `.gitignore`)
- `.env` — API credentials, never commit
- `data/` — SQLite database, Docker volume
- Keep the repo private

## Troubleshooting

**No banks listed on Connect Bank**
Check `ENABLE_BANKING_APP_ID` in `.env` and that the app is active in Enable Banking.

**Redirect URI errors from Enable Banking**
Add `http://<your-domain>:8200/api/auth/callback` to your app's redirect URLs in the Enable Banking dashboard.

**Sync pulls no transactions**
Some sandbox banks return empty transaction sets. Try a different bank or switch to production mode.

## License

All Rights Reserved.
