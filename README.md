# Roan's Banking Dashboard

A self-hosted personal finance dashboard that connects to EU bank accounts via Open Banking (PSD2). Runs in Docker, data stays in your own SQLite database.

## Features

- **Net worth** — combined balance across all linked accounts
- **Spending breakdown** — per-category totals, top merchants, monthly trends
- **Transactions** — searchable list with category filters
- **Bank linking** — OAuth via Enable Banking (Revolut, N26, Rabobank, 800+ EU banks)
- **Sync** — one-click refresh for balances and transactions
- **BankBot** — AI assistant that answers questions about your finances

## Quick start

```bash
git clone https://github.com/roanh47/Roans-Banking-Dashboard.git
cd Roans-Banking-Dashboard
cp .env.example .env
```

Edit `.env` and set your Enable Banking Application ID:

```
ENABLE_BANKING_APP_ID=your-uuid-here
```

Place your `.pem` private key in the `config/` folder (any filename works):

```
config/
├── private.pem          ← your downloaded key
└── (any-name.pem works)
```

Start the dashboard:

```bash
docker compose up -d --build
```

Open **http://localhost:8200**.

## Setup

### 1. Enable Banking application

You need an app registered at [enablebanking.com](https://enablebanking.com):

Need a **Redirect URI** — set this to `http://localhost:8200/api/auth/callback` for local use, or `https://your-domain.com/api/auth/callback` for production behind a reverse proxy.

3. **Key generation**: choose *Generate in browser*, download the `.pem` file, or choose *Generate outside browser* and let the app generate one for you (see below).

### 2. Private key

**Option A — you generated one in the Enable Banking dashboard**
Save the downloaded `.pem` anywhere in `config/`:
```
config/
├── private.pem
└── (any-name.pem works)
```

**Option B — let the app generate a key for you**
Just start the dashboard without a `.pem` file:
```bash
docker compose up -d --build
```
The entrypoint creates a new 4096-bit RSA key and prints a **public certificate** (PEM format) in the logs. Copy that certificate and upload it to your Enable Banking application as the public key.

```bash
# View the generated certificate
docker logs roans-banking-dashboard 2>&1 | grep -A 30 "Public key"
```

That's it. The entrypoint finds the `.pem` automatically — no path config needed.

### 3. Start

```bash
docker compose up -d --build
```

### 4. Connect a bank

1. Open http://localhost:8200
2. Go to Connect Bank
3. Pick your bank and authorize via OAuth
4. Your balances appear on the dashboard

Use the **Sync now** button to pull transactions.

## BankBot (AI assistant)

BankBot is a chat assistant in the bottom-right corner that can answer questions about your finances.

### Setup

Add these to your `.env` file:

```
OPENAI_API_KEY=sk-your-key-here
OPENAI_BASE_URL=https://api.openai.com/v1
```

Any OpenAI-compatible API works (OpenAI, DeepSeek, GLM, OpenRouter, etc.). Just set the base URL and key.

### Usage

1. Click the chat bubble in the bottom-right corner
2. Select a model from the dropdown (fetched automatically from `/models`)
3. Ask questions like:
   - "How much did I spend at Albert Heijn this month?"
   - "What's my current balance?"
   - "Show me my spending by category"
   - "How much income did I have last month?"

BankBot reads the dashboard's database to answer — accounts, balances, transactions, and monthly summaries.

## How it works

```
Browser → FastAPI → Enable Banking API (JWT signed with your .pem)
                ↘ SQLite (local Docker volume)
```

The entrypoint scans `config/*.pem` on every start. It signs JWT requests to Enable Banking using the first key it finds. No PEM path to configure.

## Security

- `config/*.pem` — RSA private key, never commit (in `.gitignore`)
- `.env` — API credentials, never commit
- `data/` — SQLite database, Docker volume
- Keep the repo private

## Troubleshooting

**No banks listed on Connect Bank**
Check `ENABLE_BANKING_APP_ID` in `.env` and that the app is active in Enable Banking.

**Redirect URI errors from Enable Banking**
The app automatically uses the URL you access it from. If behind a reverse proxy, ensure `X-Forwarded-Proto` and `Host` headers are set correctly.
For local use, make sure the redirect URI in your Enable Banking app matches `http://localhost:8200/api/auth/callback`.
For production, it should match `https://your-domain.com/api/auth/callback`.

**Sync pulls no transactions**
Some sandbox banks return empty transaction sets. Try a different bank or switch to production mode.

**BankBot says "not configured"**
Add `OPENAI_API_KEY` and `OPENAI_BASE_URL` to your `.env`.

## License

All Rights Reserved.
