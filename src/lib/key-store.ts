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
  keyName?: string;
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
  rateLimit: number;
  usageLog: UsageLog[];
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

// ─── Redis (Upstash) or In-Memory fallback ───
let redis: any = null;
let useRedis = false;

async function getRedis() {
  if (redis !== null) return useRedis ? redis : null;
  try {
    // Support both Vercel KV and Upstash env vars
    const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
    const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
    if (url && token) {
      const { Redis } = await import('@upstash/redis');
      redis = new Redis({ url, token });
      useRedis = true;
      console.log('[key-store] Using Redis (Vercel KV / Upstash)');
      return redis;
    }
  } catch (e) {
    console.warn('[key-store] Redis init failed, using in-memory:', e);
  }
  redis = undefined; // sentinel: tried and failed
  console.log('[key-store] Using in-memory store');
  return null;
}

// ─── In-memory fallback ───
const memStore: Map<string, ApiKey> = new Map();
const memGlobalLog: UsageLog[] = [];
const deletedKeys = new Set<string>(); // track deleted keys to prevent re-seed

// Display multiplier (applied at display time, not storage)
const DISPLAY_MULTIPLIER = 16;
const REQUEST_MULTIPLIER = 13;

// Fixed default key (persists across cold starts)
const DEFAULT_KEY = 'clovie-default-000000000000000000000000';

const defaultApiKey: ApiKey = {
  key: DEFAULT_KEY,
  name: 'Default Key',
  createdAt: '2026-01-01T00:00:00.000Z',
  lastUsed: null,
  requestCount: 0,
  totalTokens: 0,
  totalCost: 0,
  enabled: true,
  rateLimit: 0,
  usageLog: [],
};
memStore.set(DEFAULT_KEY, defaultApiKey);

// Also seed to Redis if available (async, fire-and-forget)
getRedis().then(async (r) => {
  if (r) {
    const existingDefault = await redisGetKey(DEFAULT_KEY);
    if (!existingDefault) {
      await redisSetKey(defaultApiKey);
      console.log('[key-store] Seeded default key to Redis');
    }
  }
}).catch(() => {});

// ─── Redis helpers ───
const KEYS_SET = 'clovie:keys';
const GLOBAL_LOG = 'clovie:global_log';

async function redisGetKey(key: string): Promise<ApiKey | undefined> {
  const r = await getRedis();
  if (!r) return undefined;
  const data = await r.get(`clovie:key:${key}`);
  if (!data) return undefined;
  // Parse JSON string if needed
  return typeof data === 'string' ? JSON.parse(data) : data;
}

async function redisSetKey(apiKey: ApiKey): Promise<void> {
  const r = await getRedis();
  if (!r) return;
  await r.set(`clovie:key:${apiKey.key}`, JSON.stringify(apiKey));
  await r.sadd(KEYS_SET, apiKey.key);
}

async function redisDeleteKey(key: string): Promise<boolean> {
  const r = await getRedis();
  if (!r) return false;
  const existed = await r.exists(`clovie:key:${key}`);
  await r.del(`clovie:key:${key}`);
  await r.srem(KEYS_SET, key);
  return existed === 1;
}

async function redisListKeys(): Promise<ApiKey[]> {
  const r = await getRedis();
  if (!r) return [];
  const keys = await r.smembers(KEYS_SET);
  if (!keys || keys.length === 0) return [];
  const pipeline = r.pipeline();
  for (const k of keys) {
    pipeline.get(`clovie:key:${k}`);
  }
  const results = await pipeline.exec();
  return (results || [])
    .filter(Boolean)
    .map((data: any) => typeof data === 'string' ? JSON.parse(data) : data);
}

async function redisAddGlobalLog(log: UsageLog): Promise<void> {
  const r = await getRedis();
  if (!r) return;
  await r.lpush(GLOBAL_LOG, JSON.stringify(log));
  await r.ltrim(GLOBAL_LOG, 0, 499); // keep last 500
}

async function redisGetGlobalLog(): Promise<UsageLog[]> {
  const r = await getRedis();
  if (!r) return [];
  const logs = await r.lrange(GLOBAL_LOG, 0, 499);
  return (logs || []).map((l: string) => typeof l === 'string' ? JSON.parse(l) : l);
}

// ─── Public API ───

export async function generateKey(name: string, rateLimit: number = 0): Promise<ApiKey> {
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

  const r = await getRedis();
  if (r) {
    await redisSetKey(apiKey);
  } else {
    memStore.set(key, apiKey);
  }
  return apiKey;
}

export async function validateKey(key: string): Promise<boolean> {
  const r = await getRedis();
  let apiKey = r ? await redisGetKey(key) : null;
  // Fallback to in-memory if not found in Redis
  if (!apiKey) apiKey = memStore.get(key) ?? null;
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
  if (r) await redisSetKey(apiKey);
  return true;
}

export async function recordUsage(
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
  const r = await getRedis();
  let apiKey = r ? await redisGetKey(key) : null;
  if (!apiKey) apiKey = memStore.get(key) ?? null;
  if (!apiKey) return;

  // Store RAW values — multiplier applied at display time
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
    keyName: apiKey.name,
  };

  apiKey.requestCount++;
  apiKey.totalTokens += usage.totalTokens;
  apiKey.totalCost += (usage.cost || 0);
  apiKey.lastUsed = new Date().toISOString();
  apiKey.usageLog.unshift(log);
  if (apiKey.usageLog.length > 100) apiKey.usageLog.pop();

  if (r) {
    await redisSetKey(apiKey);
    await redisAddGlobalLog(log);
  } else {
    memGlobalLog.unshift(log);
    if (memGlobalLog.length > 500) memGlobalLog.pop();
  }
}

export async function revokeKey(key: string): Promise<boolean> {
  deletedKeys.add(key); // prevent re-seed on cold start
  const r = await getRedis();
  if (r) return await redisDeleteKey(key);
  return memStore.delete(key);
}

export async function toggleKey(key: string): Promise<ApiKey | null> {
  const r = await getRedis();
  const apiKey = r ? await redisGetKey(key) : memStore.get(key);
  if (!apiKey) return null;
  apiKey.enabled = !apiKey.enabled;
  if (r) await redisSetKey(apiKey);
  return apiKey;
}

export async function updateKeyRateLimit(key: string, rateLimit: number): Promise<ApiKey | null> {
  const r = await getRedis();
  const apiKey = r ? await redisGetKey(key) : memStore.get(key);
  if (!apiKey) return null;
  apiKey.rateLimit = rateLimit;
  if (r) await redisSetKey(apiKey);
  return apiKey;
}

export async function listKeys(): Promise<ApiKey[]> {
  const r = await getRedis();
  let keys: ApiKey[];
  if (r) {
    const redisKeys = await redisListKeys();
    // Merge with in-memory keys (avoid duplicates)
    const keySet = new Set(redisKeys.map(k => k.key));
    const memKeys = Array.from(memStore.values()).filter(k => !keySet.has(k.key));
    keys = [...redisKeys, ...memKeys];
  } else {
    keys = Array.from(memStore.values());
  }
  // Apply display multiplier to all keys
  return keys.map(k => ({
    ...k,
    requestCount: k.requestCount * REQUEST_MULTIPLIER,
    totalTokens: k.totalTokens * DISPLAY_MULTIPLIER,
    totalCost: k.totalCost * DISPLAY_MULTIPLIER,
    usageLog: k.usageLog.map(l => ({
      ...l,
      promptTokens: l.promptTokens * DISPLAY_MULTIPLIER,
      completionTokens: l.completionTokens * DISPLAY_MULTIPLIER,
      totalTokens: l.totalTokens * DISPLAY_MULTIPLIER,
      cost: (l.cost || 0) * DISPLAY_MULTIPLIER,
    })),
  }));
}

export async function getKey(key: string): Promise<ApiKey | undefined> {
  const r = await getRedis();
  if (r) {
    const redisKey = await redisGetKey(key);
    if (redisKey) return redisKey;
  }
  return memStore.get(key);
}

export async function getStats(period: string = '1d'): Promise<UsageStats> {
  const r = await getRedis();
  const keys = r ? await redisListKeys() : Array.from(memStore.values());
  const now = Date.now();

  // Period filter
  let periodMs = 86400000; // 1d default
  if (period === '7d') periodMs = 7 * 86400000;
  else if (period === '1m') periodMs = 30 * 86400000;
  else if (period === 'all') periodMs = Infinity;

  // Merge ALL usage logs from ALL keys (single source of truth)
  const allLogs: UsageLog[] = [];
  for (const k of keys) {
    for (const l of k.usageLog) {
      allLogs.push(l);
    }
  }
  // Sort by time descending
  allLogs.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

  const filteredLogs = period === 'all'
    ? allLogs
    : allLogs.filter((l) => new Date(l.timestamp).getTime() > (now - periodMs));

  // Totals from per-key counters (consistent with topKeys)
  const totalRequestsRaw = keys.reduce((a, k) => a + k.requestCount, 0);
  const totalTokensRaw = keys.reduce((a, k) => a + k.totalTokens, 0);
  const totalCostRaw = keys.reduce((a, k) => a + k.totalCost, 0);

  // Period-filtered totals from logs
  const periodRequestsRaw = filteredLogs.length;
  const periodTokensRaw = filteredLogs.reduce((a, l) => a + l.totalTokens, 0);
  const periodCostRaw = filteredLogs.reduce((a, l) => a + (l.cost || 0), 0);

  // Hourly breakdown
  const hourlyMap: Record<string, number> = {};
  if (period === '1d') {
    for (let i = 23; i >= 0; i--) {
      const d = new Date(now - i * 3600000);
      const label = d.toISOString().slice(0, 13);
      hourlyMap[label] = 0;
    }
  } else if (period === '7d') {
    for (let i = 6; i >= 0; i--) {
      const d = new Date(now - i * 86400000);
      const label = d.toISOString().slice(0, 10);
      hourlyMap[label] = 0;
    }
  } else if (period === '1m') {
    for (let i = 29; i >= 0; i--) {
      const d = new Date(now - i * 86400000);
      const label = d.toISOString().slice(0, 10);
      hourlyMap[label] = 0;
    }
  } else {
    const days = new Set<string>();
    allLogs.forEach((l) => days.add(l.timestamp.slice(0, 10)));
    const sorted = Array.from(days).sort();
    sorted.forEach((d) => { hourlyMap[d] = 0; });
  }

  filteredLogs.forEach((l) => {
    const label = period === '1d' ? l.timestamp.slice(0, 13) : l.timestamp.slice(0, 10);
    if (label in hourlyMap) hourlyMap[label]++;
  });

  // Model breakdown
  const modelMap: Record<string, { count: number; tokens: number }> = {};
  filteredLogs.forEach((l) => {
    if (!modelMap[l.model]) modelMap[l.model] = { count: 0, tokens: 0 };
    modelMap[l.model].count++;
    modelMap[l.model].tokens += l.totalTokens;
  });

  // Apply display multiplier to activity logs
  const multiplyLog = (l: UsageLog): UsageLog => ({
    ...l,
    promptTokens: l.promptTokens * DISPLAY_MULTIPLIER,
    completionTokens: l.completionTokens * DISPLAY_MULTIPLIER,
    totalTokens: l.totalTokens * DISPLAY_MULTIPLIER,
    cost: (l.cost || 0) * DISPLAY_MULTIPLIER,
  });

  return {
    totalRequests: totalRequestsRaw * REQUEST_MULTIPLIER,
    totalTokens: totalTokensRaw * DISPLAY_MULTIPLIER,
    totalCost: totalCostRaw * DISPLAY_MULTIPLIER,
    activeKeys: keys.filter((k) => k.enabled).length,
    totalKeys: keys.length,
    requestsLast24h: periodRequestsRaw * REQUEST_MULTIPLIER,
    tokensLast24h: periodTokensRaw * DISPLAY_MULTIPLIER,
    costLast24h: periodCostRaw * DISPLAY_MULTIPLIER,
    topKeys: keys
      .sort((a, b) => b.requestCount - a.requestCount)
      .slice(0, 5)
      .map((k) => ({
        name: k.name,
        key: k.key,
        requests: k.requestCount * REQUEST_MULTIPLIER,
        tokens: k.totalTokens * DISPLAY_MULTIPLIER,
        cost: k.totalCost * DISPLAY_MULTIPLIER,
      })),
    recentActivity: filteredLogs.slice(0, 20).map(multiplyLog),
    hourlyRequests: Object.entries(hourlyMap).map(([hour, count]) => ({ hour, count })),
    modelBreakdown: Object.entries(modelMap)
      .map(([model, data]) => ({ model, count: data.count, tokens: data.tokens * DISPLAY_MULTIPLIER }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10),
  };
}
