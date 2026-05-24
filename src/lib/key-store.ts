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
    if (process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN) {
      const { Redis } = await import('@upstash/redis');
      redis = new Redis({
        url: process.env.UPSTASH_REDIS_REST_URL,
        token: process.env.UPSTASH_REDIS_REST_TOKEN,
      });
      useRedis = true;
      console.log('[key-store] Using Upstash Redis');
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

// Seed default key in memory
const DEFAULT_KEY = 'clovie-' + randomBytes(24).toString('hex');
memStore.set(DEFAULT_KEY, {
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

// ─── Redis helpers ───
const KEYS_SET = 'clovie:keys';
const GLOBAL_LOG = 'clovie:global_log';

async function redisGetKey(key: string): Promise<ApiKey | undefined> {
  const r = await getRedis();
  if (!r) return undefined;
  const data = await r.get(`clovie:key:${key}`);
  return data as ApiKey | undefined;
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
  return (results || []).filter(Boolean) as ApiKey[];
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
  const apiKey = r ? await redisGetKey(key) : memStore.get(key);
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
  const apiKey = r ? await redisGetKey(key) : memStore.get(key);
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

  if (r) {
    await redisSetKey(apiKey);
    await redisAddGlobalLog(log);
  } else {
    memGlobalLog.unshift(log);
    if (memGlobalLog.length > 500) memGlobalLog.pop();
  }
}

export async function revokeKey(key: string): Promise<boolean> {
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
  if (r) return await redisListKeys();
  return Array.from(memStore.values());
}

export async function getKey(key: string): Promise<ApiKey | undefined> {
  const r = await getRedis();
  if (r) return await redisGetKey(key) ?? undefined;
  return memStore.get(key);
}

export async function getStats(): Promise<UsageStats> {
  const r = await getRedis();
  const keys = r ? await redisListKeys() : Array.from(memStore.values());
  const globalLog = r ? await redisGetGlobalLog() : [...memGlobalLog];
  const now = Date.now();
  const h24 = now - 86400000;

  const recentLogs = globalLog.filter(
    (l) => new Date(l.timestamp).getTime() > h24
  );

  // Hourly breakdown (last 24h)
  const hourlyMap: Record<string, number> = {};
  for (let i = 23; i >= 0; i--) {
    const d = new Date(now - i * 3600000);
    const label = d.toISOString().slice(0, 13);
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

  const totalCostFromLogs = globalLog.reduce((a, l) => a + (l.cost || 0), 0);
  const totalRequestsFromLogs = globalLog.length;
  const totalTokensFromLogs = globalLog.reduce((a, l) => a + l.totalTokens, 0);

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
    recentActivity: globalLog.slice(0, 20),
    hourlyRequests: Object.entries(hourlyMap).map(([hour, count]) => ({ hour, count })),
    modelBreakdown: Object.entries(modelMap)
      .map(([model, data]) => ({ model, ...data }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10),
  };
}
