// Roan's Banking App — API Client
// Talks to the self-hosted FastAPI backend

import * as SecureStore from 'expo-secure-store';

const STORE_KEY = 'banking_app_settings';

export interface AppSettings {
  ServerUrl: string;
  EnableBankingAppId: string;
  AiEndpoint: string;
  AiApiKey: string;
  AiModel: string;
}

export async function getSettings(): Promise<AppSettings> {
  try {
    const raw = await SecureStore.getItemAsync(STORE_KEY);
    if (raw) return JSON.parse(raw);
  } catch {}
  return { ServerUrl: '', EnableBankingAppId: '', AiEndpoint: '', AiApiKey: '', AiModel: '' };
}

export async function saveSettings(s: AppSettings): Promise<void> {
  await SecureStore.setItemAsync(STORE_KEY, JSON.stringify(s));
}

async function baseUrl(): Promise<string> {
  const s = await getSettings();
  return s.ServerUrl.replace(/\/+$/, '');
}

async function apiGet<T>(path: string): Promise<T> {
  const base = await baseUrl();
  const res = await fetch(`${base}${path}`);
  if (!res.ok) throw new Error(`API ${res.status}: ${await res.text()}`);
  return res.json();
}

async function apiPost<T>(path: string, body: unknown): Promise<T> {
  const base = await baseUrl();
  const res = await fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`API ${res.status}: ${await res.text()}`);
  return res.json();
}

async function apiDelete<T>(path: string): Promise<T> {
  const base = await baseUrl();
  const res = await fetch(`${base}${path}`, { method: 'DELETE' });
  if (!res.ok) throw new Error(`API ${res.status}: ${await res.text()}`);
  return res.json();
}

async function apiPut<T>(path: string, body: unknown): Promise<T> {
  const base = await baseUrl();
  const res = await fetch(`${base}${path}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`API ${res.status}: ${await res.text()}`);
  return res.json();
}

// ── Public API ──────────────────────────────────────────────

export interface AccountSummary {
  total_balance: number;
  account_count: number;
}

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

export interface MonthlyData {
  month: string;
  income: number;
  spending: number;
}

export interface SpendingInsight {
  category: string;
  total: number;
  count: number;
}

export interface TopMerchant {
  merchant: string;
  total: number;
}

export interface BankConnection {
  id: number;
  bank_name: string;
  created_at: string;
  expires_at: string;
  account_count: number;
}

export function fetchAccountSummary() {
  return apiGet<AccountSummary>('/api/accounts/summary');
}

export function fetchAccounts() {
  return apiGet<{ accounts: Account[] }>('/api/accounts');
}

export function fetchTransactions(limit = 100, days = 90) {
  return apiGet<{ transactions: Transaction[] }>(`/api/transactions?limit=${limit}&days=${days}`);
}

export function fetchMonthlyInsights() {
  return apiGet<{ months: MonthlyData[] }>('/api/insights/monthly');
}

export function fetchSpendingInsights(days = 90) {
  return apiGet<{ insights: SpendingInsight[] }>(`/api/insights/spending?days=${days}`);
}

export function fetchTopMerchants(days = 30, limit = 5) {
  return apiGet<{ merchants: TopMerchant[] }>(`/api/insights/top-merchants?days=${days}&limit=${limit}`);
}

export function fetchConnections() {
  return apiGet<{ connections: BankConnection[] }>('/api/auth/connections');
}

export function deleteConnection(id: number) {
  return apiDelete<{ deleted: boolean }>(`/api/auth/connections/${id}`);
}

export function syncAll() {
  return apiPost<{ synced: number }>('/api/sync', {});
}

export function sendChatMessage(message: string, model: string) {
  return apiPost<{ reply: string }>('/api/chat', { message, model });
}

export function fetchChatModels() {
  return apiGet<{ models: string[] }>('/api/chat/models');
}

export function fetchAiSettings() {
  return apiGet<Record<string, string>>('/api/ai/settings');
}

export function updateAiSettings(settings: Record<string, string>) {
  return apiPut<{ ok: boolean }>('/api/ai/settings', settings);
}

export function fetchAiModels() {
  return apiGet<{ models: string[] }>('/api/ai/models');
}

export function testConnection(url: string) {
  return fetch(`${url.replace(/\/+$/, '')}/api/accounts/summary`, { method: 'GET' })
    .then(r => r.ok)
    .catch(() => false);
}
