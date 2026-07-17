// Roan's Banking App — API Client
// Talks directly to Enable Banking API + AI endpoint (standalone, no server)

import * as SecureStore from 'expo-secure-store';
import * as WebBrowser from 'expo-web-browser';
import * as Crypto from 'expo-crypto';

const STORE_KEY = 'banking_app_settings';
const ACCOUNTS_KEY = 'banking_accounts';
const TRANSACTIONS_KEY = 'banking_transactions';

export interface AppSettings {
  EnableBankingAppId: string;
  EnableBankingKey: string;
  AiEndpoint: string;
  AiApiKey: string;
  AiModel: string;
}

// ── Settings Storage ────────────────────────────────────────

export async function getSettings(): Promise<AppSettings> {
  try {
    const raw = await SecureStore.getItemAsync(STORE_KEY);
    if (raw) return JSON.parse(raw);
  } catch {}
  return { EnableBankingAppId: '', EnableBankingKey: '', AiEndpoint: '', AiApiKey: '', AiModel: '' };
}

export async function saveSettings(s: AppSettings): Promise<void> {
  await SecureStore.setItemAsync(STORE_KEY, JSON.stringify(s));
}

// ── Enable Banking (direct API) ─────────────────────────────

const EB_BASE = 'https://api.enablebanking.com';
const REDIRECT_URI = 'http://localhost:8080/api/auth/callback';

// Simple JWT signing using the private key (RS256)
// We construct the JWT manually since we need RSA signing
function base64url(str: string): string {
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function makeJwt(appId: string, privateKey: string): Promise<string> {
  const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT', kid: appId }));
  const now = Math.floor(Date.now() / 1000);
  const payload = base64url(JSON.stringify({
    iss: 'enablebanking.com',
    aud: 'api.enablebanking.com',
    iat: now,
    exp: now + 3600,
  }));
  const unsigned = `${header}.${payload}`;

  // RSA signing requires native crypto — we'll use a workaround for now.
  // For production, use react-native-rsa-native or similar.
  // For v0.0.1, we'll do the auth flow in-app and exchange the code directly.
  return `${unsigned}.signature_placeholder`;
}

async function ebFetch(path: string, options: RequestInit = {}): Promise<any> {
  const s = await getSettings();
  if (!s.EnableBankingAppId || !s.EnableBankingKey) {
    throw new Error('Enable Banking not configured. Set your App ID and Private Key in Profile.');
  }

  const jwt = await makeJwt(s.EnableBankingAppId, s.EnableBankingKey);
  const res = await fetch(`${EB_BASE}${path}`, {
    ...options,
    headers: {
      'Authorization': `Bearer ${jwt}`,
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Enable Banking ${res.status}: ${text.slice(0, 200)}`);
  }
  return res.json();
}

export async function fetchBanks() {
  const data = await ebFetch('/aspsps');
  return data.aspsps || data;
}

export async function startBankAuth(bankName: string, bankCountry: string) {
  const data = await ebFetch('/auth', {
    method: 'POST',
    body: JSON.stringify({
      aspsp: { name: bankName, country: bankCountry },
      redirect_url: REDIRECT_URI,
      psu_type: 'personal',
      access: {
        valid_until: new Date(Date.now() + 180 * 24 * 60 * 60 * 1000).toISOString().replace('+00:00', 'Z'),
      },
    }),
  });
  return data;
}

export async function openBankAuth(authUrl: string) {
  const result = await WebBrowser.openAuthSessionAsync(authUrl, REDIRECT_URI);
  if (result.type === 'success' && result.url) {
    const url = new URL(result.url);
    const code = url.searchParams.get('code');
    if (code) return { code };
    throw new Error('No authorization code in redirect');
  }
  throw new Error('Auth cancelled or failed');
}

export async function exchangeCode(code: string) {
  return ebFetch('/sessions', {
    method: 'POST',
    body: JSON.stringify({ code }),
  });
}

export async function fetchAccountBalances(accountId: string) {
  return ebFetch(`/accounts/${accountId}/balances`);
}

export async function fetchAccountTransactions(accountId: string, dateFrom?: string, dateTo?: string) {
  let path = `/accounts/${accountId}/transactions`;
  const params = new URLSearchParams();
  if (dateFrom) params.set('date_from', dateFrom);
  if (dateTo) params.set('date_to', dateTo);
  const qs = params.toString();
  if (qs) path += `?${qs}`;
  return ebFetch(path);
}

// ── AI / BankBot (direct to user's AI endpoint) ─────────────

export async function sendChatMessage(message: string, model: string, context: string = '') {
  const s = await getSettings();
  if (!s.AiEndpoint || !s.AiApiKey) throw new Error('AI not configured');

  const res = await fetch(`${s.AiEndpoint.replace(/\/+$/, '')}/chat/completions`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${s.AiApiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: model || s.AiModel,
      messages: [
        { role: 'system', content: `You are BankBot, a financial assistant. ${context}` },
        { role: 'user', content: message },
      ],
      temperature: 0.3,
      max_tokens: 1024,
    }),
  });
  if (!res.ok) throw new Error(`AI API ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return data.choices[0].message.content;
}

export async function fetchAiModels(): Promise<string[]> {
  const s = await getSettings();
  if (!s.AiEndpoint) return [];
  try {
    const res = await fetch(`${s.AiEndpoint.replace(/\/+$/, '')}/models`, {
      headers: { 'Authorization': `Bearer ${s.AiApiKey}` },
    });
    if (!res.ok) return [];
    const data = await res.json();
    const models = data.data || data;
    return Array.isArray(models) ? models.map((m: any) => m.id).filter(Boolean) : [];
  } catch {
    return [];
  }
}

// ── Local Data (stored on device) ───────────────────────────

export interface Account {
  id: string;
  name: string;
  iban: string;
  currency: string;
  balance: number;
  account_type: string;
}

export interface Transaction {
  id: string;
  amount: number;
  currency: string;
  description: string;
  booking_date: string;
  category: string;
  merchant_name: string;
}

export async function getLocalAccounts(): Promise<Account[]> {
  try {
    const raw = await SecureStore.getItemAsync(ACCOUNTS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

export async function saveLocalAccounts(accounts: Account[]) {
  await SecureStore.setItemAsync(ACCOUNTS_KEY, JSON.stringify(accounts));
}

export async function getLocalTransactions(): Promise<Transaction[]> {
  try {
    const raw = await SecureStore.getItemAsync(TRANSACTIONS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

export async function saveLocalTransactions(txs: Transaction[]) {
  await SecureStore.setItemAsync(TRANSACTIONS_KEY, JSON.stringify(txs));
}
