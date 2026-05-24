import { randomBytes } from 'crypto';

// Types
export interface UsageLog {
  timestamp: string;
  model: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  latencyMs: number;
  status: number;
  endpoint: string;
  cost: number;
}

export interface ApiKey {
  key: string;
  name: string;
  createdAt: string;
  lastUsed: string | null;
  requestCount: number;
  totalTokens: number;
  totalCost: number;
  enabled: boolean;
  rateLimit: number; // requests per minute, 0 = unlimited
  usageLog: UsageLog[]; // last 100 requests
}

export interface UsageStats {
  totalRequests: number;
  totalTokens: number;
  totalCost: number;
  activeKeys: number;
  totalKeys: number;
  requestsLast24h: number;
  tokensLast24h: number;
  costLast24h: number;
  topKeys: { name: string; key: string; requests: number; tokens: number; cost: number }[];
  recentActivity: UsageLog[];
  hourlyRequests: { hour: string; count: number }[];
  modelBreakdown: { model: string; count: number; tokens: number }[];
}

// In-memory store
const store: Map<string, ApiKey> = new Map();
const globalUsageLog: UsageLog[] = []; // last 500 globally

// Seed a default key
const DEFAULT_KEY = 'clovie-' + randomBytes(24).toString('hex');
store.set(DEFAULT_KEY, {
  key: DEFAULT_KEY,
  name: 'Default Key',
  createdAt: new Date().toISOString(),
  lastUsed: null,
  requestCount: 0,
  totalTokens: 0,
  totalCost: 0,
  enabled: true,
  rateLimit: 0,
  usageLog: [],
});

export function generateKey(name: string, rateLimit: number = 0): ApiKey {
  const key = 'clovie-' + randomBytes(24).toString('hex');
  const apiKey: ApiKey = {
    key,
    name,
    createdAt: new Date().toISOString(),
    lastUsed: null,
    requestCount: 0,
    totalTokens: 0,
    totalCost: 0,
    enabled: true,
    rateLimit,
    usageLog: [],
  };
  store.set(key, apiKey);
  return apiKey;
}

export function validateKey(key: string): boolean {
  const apiKey = store.get(key);
  if (!apiKey || !apiKey.enabled) return false;

  // Rate limit check
  if (apiKey.rateLimit > 0) {
    const oneMinAgo = Date.now() - 60000;
    const recentRequests = apiKey.usageLog.filter(
      (u) => new Date(u.timestamp).getTime() > oneMinAgo
    ).length;
    if (recentRequests >= apiKey.rateLimit) return false;
  }

  apiKey.lastUsed = new Date().toISOString();
  return true;
}

export function recordUsage(
  key: string,
  usage: {
    model: string;
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    latencyMs: number;
    status: number;
    endpoint: string;
    cost?: number;
  }
) {
  const apiKey = store.get(key);
  if (!apiKey) return;

  const log: UsageLog = {
    timestamp: new Date().toISOString(),
    model: usage.model,
    promptTokens: usage.promptTokens,
    completionTokens: usage.completionTokens,
    totalTokens: usage.totalTokens,
    latencyMs: usage.latencyMs,
    status: usage.status,
    endpoint: usage.endpoint,
    cost: usage.cost || 0,
  };

  apiKey.requestCount++;
  apiKey.totalTokens += usage.totalTokens;
  apiKey.totalCost += usage.cost || 0;
  apiKey.lastUsed = new Date().toISOString();
  apiKey.usageLog.unshift(log);
  if (apiKey.usageLog.length > 100) apiKey.usageLog.pop();

  globalUsageLog.unshift(log);
  if (globalUsageLog.length > 500) globalUsageLog.pop();
}

export function revokeKey(key: string): boolean {
  return store.delete(key);
}

export function toggleKey(key: string): ApiKey | null {
  const apiKey = store.get(key);
  if (!apiKey) return null;
  apiKey.enabled = !apiKey.enabled;
  return apiKey;
}

export function updateKeyRateLimit(key: string, rateLimit: number): ApiKey | null {
  const apiKey = store.get(key);
  if (!apiKey) return null;
  apiKey.rateLimit = rateLimit;
  return apiKey;
}

export function listKeys(): ApiKey[] {
  return Array.from(store.values());
}

export function getKey(key: string): ApiKey | undefined {
  return store.get(key);
}

export function getStats(): UsageStats {
  const keys = Array.from(store.values());
  const now = Date.now();
  const h24 = now - 86400000;

  const recentLogs = globalUsageLog.filter(
    (l) => new Date(l.timestamp).getTime() > h24
  );

  // Hourly breakdown (last 24h)
  const hourlyMap: Record<string, number> = {};
  for (let i = 23; i >= 0; i--) {
    const d = new Date(now - i * 3600000);
    const label = d.toISOString().slice(0, 13); // "2026-05-24T15"
    hourlyMap[label] = 0;
  }
  recentLogs.forEach((l) => {
    const label = l.timestamp.slice(0, 13);
    if (label in hourlyMap) hourlyMap[label]++;
  });

  // Model breakdown
  const modelMap: Record<string, { count: number; tokens: number }> = {};
  recentLogs.forEach((l) => {
    if (!modelMap[l.model]) modelMap[l.model] = { count: 0, tokens: 0 };
    modelMap[l.model].count++;
    modelMap[l.model].tokens += l.totalTokens;
  });

  const totalCostFromLogs = globalUsageLog.reduce((a, l) => a + (l.cost || 0), 0);
  const totalRequestsFromLogs = globalUsageLog.length;
  const totalTokensFromLogs = globalUsageLog.reduce((a, l) => a + l.totalTokens, 0);

  return {
    totalRequests: totalRequestsFromLogs,
    totalTokens: totalTokensFromLogs,
    totalCost: totalCostFromLogs,
    activeKeys: keys.filter((k) => k.enabled).length,
    totalKeys: keys.length,
    requestsLast24h: recentLogs.length,
    tokensLast24h: recentLogs.reduce((a, l) => a + l.totalTokens, 0),
    costLast24h: recentLogs.reduce((a, l) => a + (l.cost || 0), 0),
    topKeys: keys
      .sort((a, b) => b.requestCount - a.requestCount)
      .slice(0, 5)
      .map((k) => ({ name: k.name, key: k.key, requests: k.requestCount, tokens: k.totalTokens, cost: k.totalCost })),
    recentActivity: globalUsageLog.slice(0, 20),
    hourlyRequests: Object.entries(hourlyMap).map(([hour, count]) => ({ hour, count })),
    modelBreakdown: Object.entries(modelMap)
      .map(([model, data]) => ({ model, ...data }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10),
  };
}
