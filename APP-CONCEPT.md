# Roan's Banking App — Concept

## What it is
A mobile version of Roan's Banking Dashboard. Connects to your self-hosted Backend (the same FastAPI+SQLite you already have) and shows your finances on your phone.

## How it works
The Expo App is a **client** — it doesn't run the banking logic itself. Your Docker Backend stays as-is, the App just talks to its API.

```
Phone (Expo App) → your-server:8200 → Enable Banking API
                                     → SQLite (your data)
                                     → AI endpoint (BankBot)
```

The App needs to know your server URL. That's configured in the Profile/Settings screen.

---

## Folder structure (reorganized)

```
Roans-Banking-Dashboard/
├── Docker/                    ← everything Docker
│   ├── Dockerfile
│   ├── docker-compose.yml
│   ├── docker-entrypoint.sh
│   └── .env.example
├── Backend/                   ← unchanged (FastAPI + SQLite)
│   ├── App/
│   └── requirements.txt
├── Frontend/                  ← unchanged (web dashboard)
│   ├── index.html
│   ├── JS/
│   └── CSS/
├── App/                       ← NEW: Expo mobile app
│   ├── app.json
│   ├── package.json
│   ├── Src/
│   │   ├── Screens/
│   │   │   ├── HomeScreen.tsx
│   │   │   ├── TransactionsScreen.tsx
│   │   │   ├── InsightsScreen.tsx
│   │   │   ├── ChatScreen.tsx
│   │   │   └── ProfileScreen.tsx
│   │   ├── Components/
│   │   │   ├── AccountCard.tsx
│   │   │   ├── TransactionRow.tsx
│   │   │   ├── SpendingChart.tsx
│   │   │   └── BottomBar.tsx
│   │   ├── API/
│   │   │   └── Client.ts      ← talks to your backend
│   │   ├── Theme/
│   │   │   └── Colors.ts
│   │   └── App.tsx
│   └── Assets/
└── README.md
```

---

## Bottom navigation bar

5 tabs, simple icons:

```
┌──────────────────────────────────────────────┐
│   🏠       📊       📄       🤖       👤     │
│  Home   Insights   Txns    ChatBot  Profile  │
└──────────────────────────────────────────────┘
```

- **Home** — net worth, account cards, monthly overview chart, spending pie, top merchants
- **Insights** — full spending breakdown, monthly income vs spending, category table
- **Transactions** — searchable list with category filters (same as web)
- **ChatBot** — full-screen chat with BankBot (model selector, conversation)
- **Profile** — settings + connection status (see below)

---

## Profile / Settings screen

This is the key screen. It has these sections:

### 1. Server connection
- **Server URL** — text input (e.g. `https://banking.roanheemstra.nl` or `http://192.168.1.x:8200`)
- **Connection status** — green dot if reachable, red if not
- **Test connection** button

### 2. Enable Banking
- **Application ID** — text input
- **Private key** — file picker or paste (the .pem content)
- Status: "Connected" / "Not configured"
- List of linked banks (with delete option)

### 3. AI / BankBot
- **AI Endpoint** — text input (e.g. `https://api.openai.com/v1`)
- **API Key** — password field
- **Model** — dropdown (auto-fetched from endpoint's /models)
- **Test** button — sends a quick prompt to verify it works

### 4. App settings
- Currency display preference (EUR default)
- Theme toggle (dark/light)
- About / version

All settings stored locally on the phone (AsyncStorage). The App sends Enable Banking credentials to the Backend's API, or — if the Backend already has them in .env — just uses the server URL.

---

## UI style — "Glass Dark"

Not Material You, not Liquid Glass. A clean dark theme with subtle depth.

- **Background**: #0A0A0F (near-black)
- **Cards**: #14141F with 1px border #1E1E2E, slight rounded corners (12px)
- **Accent**: #6C5CE7 (purple) for buttons and highlights
- **Positive numbers**: #00D68F (green)
- **Negative numbers**: #FF6B6B (red)
- **Text**: #E8E8F0 primary, #8888A0 secondary
- **Font**: Inter (same as web dashboard)

Charts: same Chart.js-style colors as the web version (doughnut + bar).

No glassmorphism, no blur effects, no material ripple. Just clean dark cards with good spacing.

---

## Screens in detail

### Home screen
```
┌─────────────────────────────┐
│  Good morning, Roan    ⟳   │  ← pull to sync
├─────────────────────────────┤
│  ┌───────────────────────┐  │
│  │  Net Worth            │  │
│  │  €12,450.00           │  │
│  │  3 accounts           │  │
│  └───────────────────────┘  │
│  ┌──────────┐ ┌──────────┐  │
│  │ Spending │ │ Income   │  │
│  │ -€1,200  │ │ +€2,100  │  │
│  │ this mo  │ │ this mo  │  │
│  └──────────┘ └──────────┘  │
│                             │
│  ┌───────────────────────┐  │
│  │  Monthly Overview     │  │
│  │  [bar chart]          │  │
│  └───────────────────────┘  │
│  ┌──────────┐ ┌──────────┐  │
│  │ Category │ │ Top      │  │
│  │ [donut]  │ │ Merchants│  │
│  └──────────┘ └──────────┘  │
└─────────────────────────────┘
```

### Transactions screen
```
┌─────────────────────────────┐
│  🔍 Search...    [Category▾]│
├─────────────────────────────┤
│  15 Jul  Albert Heijn  -€45 │
│  14 Jul  Salary      +€2100 │
│  14 Jul  Spotify       -€10 │
│  ...                        │
└─────────────────────────────┘
```

### Chat screen
```
┌─────────────────────────────┐
│  BankBot         [Model  ▾] │
├─────────────────────────────┤
│                             │
│  "How much did I spend at   │
│   AH this month?"           │
│                             │
│         "You spent €187.40  │
│   at Albert Heijn in July"  │
│                             │
├─────────────────────────────┤
│  Type a message...     [➤]  │
└─────────────────────────────┘
```

### Profile screen
```
┌─────────────────────────────┐
│  Profile & Settings         │
├─────────────────────────────┤
│  SERVER                     │
│  ┌───────────────────────┐  │
│  │ URL: https://bank...  │  │
│  │ Status: 🟢 Connected  │  │
│  └───────────────────────┘  │
│                             │
│  ENABLE BANKING             │
│  ┌───────────────────────┐  │
│  │ App ID: xxx-xxx-xxx   │  │
│  │ Banks: Revolut, N26   │  │
│  └───────────────────────┘  │
│                             │
│  AI / BANKBOT               │
│  ┌───────────────────────┐  │
│  │ Endpoint: openai...   │  │
│  │ Key: ••••••••         │  │
│  │ Model: gpt-4o-mini    │  │
│  └───────────────────────┘  │
│                             │
│  PREFERENCES                │
│  Currency: EUR              │
│  Theme: Dark                │
│                             │
│  ┌───────────────────────┐  │
│  │    Save Settings      │  │
│  └───────────────────────┘  │
└─────────────────────────────┘
```

---

## Tech stack

- **Framework**: Expo (React Native)
- **Language**: TypeScript
- **Navigation**: expo-router (file-based routing)
- **Charts**: react-native-chart-kit or victory-native
- **Storage**: expo-secure-store (for API keys) + AsyncStorage (for preferences)
- **HTTP**: fetch (built-in, matches the web dashboard's pattern)
- **Icons**: @expo/vector-icons (Ionicons)

---

## Backend changes needed

Minimal. The existing API works as-is. Two small additions:

1. **CORS** — add CORS middleware so the App can talk to the Backend from a different origin
2. **Auth endpoint for mobile** — the OAuth redirect flow needs a mobile-aware callback (deep link back to the App instead of redirecting to the web dashboard)

Everything else (accounts, transactions, insights, chat, AI settings) already has REST endpoints the App can use directly.

---

## Build & run

```bash
cd App
npx expo start          # dev mode, scan QR with Expo Go
npx expo build:android  # APK for Android
npx expo build:ios      # IPA for iOS (needs Apple Developer account)
```

EAS Build for cloud builds (no local SDK needed):
```bash
npx eas build --platform android
npx eas build --platform ios
```
