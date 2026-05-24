'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';

// Types
interface ApiKey {
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

interface UsageLog {
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

interface Stats {
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

type Tab = 'overview' | 'keys' | 'models' | 'activity';

export default function Dashboard() {
  // Auth state
  const [token, setToken] = useState<string | null>(null);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loginError, setLoginError] = useState('');
  const [loginLoading, setLoginLoading] = useState(false);

  // Dashboard state
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [newName, setNewName] = useState('');
  const [newRateLimit, setNewRateLimit] = useState('');
  const [loading, setLoading] = useState(false);
  const [copiedField, setCopiedField] = useState('');
  const [models, setModels] = useState<{id: string; name: string; context_length: number; pricing: {prompt: string; completion: string}; architecture: {modality: string}}[]>([]);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [modelSearch, setModelSearch] = useState('');
  const [tab, setTab] = useState<Tab>('overview');
  const [baseUrl, setBaseUrl] = useState('');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  useEffect(() => {
    setBaseUrl(window.location.origin + '/v1');
    const stored = localStorage.getItem('clovie_token');
    if (stored) setToken(stored);
  }, []);

  const headers = useMemo(() => ({
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${token}`,
  }), [token]);

  const fetchKeys = useCallback(async () => {
    if (!token) return;
    try {
      const res = await fetch('/api/admin/keys', { headers });
      if (res.status === 401) { setToken(null); localStorage.removeItem('ogw_token'); return; }
      const data = await res.json();
      setKeys(data.keys || []);
    } catch { /* ignore */ }
  }, [token, headers]);

  const fetchStats = useCallback(async () => {
    if (!token) return;
    try {
      const res = await fetch('/api/admin/stats', { headers });
      if (res.ok) setStats(await res.json());
    } catch { /* ignore */ }
  }, [token, headers]);

  const fetchModels = useCallback(async () => {
    setModelsLoading(true);
    try {
      const res = await fetch('/api/models');
      if (res.ok) {
        const data = await res.json();
        setModels(data.models || []);
      }
    } catch { /* ignore */ } finally { setModelsLoading(false); }
  }, []);

  useEffect(() => {
    if (token) {
      fetchKeys();
      fetchStats();
      fetchModels();
      const interval = setInterval(() => { fetchKeys(); fetchStats(); }, 10000);
      return () => clearInterval(interval);
    }
  }, [token, fetchKeys, fetchStats]);

  // Login
  const handleLogin = async () => {
    setLoginLoading(true);
    setLoginError('');
    try {
      const res = await fetch('/api/admin/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });
      if (res.ok) {
        const data = await res.json();
        setToken(data.token);
        localStorage.setItem('clovie_token', data.token);
      } else {
        setLoginError('Invalid credentials');
      }
    } catch {
      setLoginError('Connection failed');
    } finally {
      setLoginLoading(false);
    }
  };

  const logout = () => {
    setToken(null);
    localStorage.removeItem('ogw_token');
  };

  // Key actions
  const createKey = async () => {
    if (!newName.trim()) return;
    setLoading(true);
    try {
      const res = await fetch('/api/admin/keys', {
        method: 'POST',
        headers,
        body: JSON.stringify({ name: newName, rate_limit: parseInt(newRateLimit) || 0 }),
      });
      if (res.ok) { setNewName(''); setNewRateLimit(''); await fetchKeys(); }
    } finally { setLoading(false); }
  };

  const revokeKey = async (key: string) => {
    if (!confirm('Revoke this key permanently?')) return;
    await fetch('/api/admin/keys', { method: 'DELETE', headers, body: JSON.stringify({ key }) });
    await fetchKeys();
  };

  const toggleKey = async (key: string) => {
    await fetch('/api/admin/keys', { method: 'PATCH', headers, body: JSON.stringify({ key }) });
    await fetchKeys();
  };

  const copy = (field: string, text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedField(field);
    setTimeout(() => setCopiedField(''), 2000);
  };

  // Format helpers
  const fmtNum = (n: number) => n >= 1000000 ? (n / 1000000).toFixed(1) + 'M' : n >= 1000 ? (n / 1000).toFixed(1) + 'K' : String(n);
  const fmtTime = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const fmtLatency = (ms: number) => ms >= 1000 ? (ms / 1000).toFixed(1) + 's' : ms + 'ms';
  const fmtPrice = (p?: string) => { const n = parseFloat(p || '0'); return n === 0 ? 'Free' : '$' + n.toFixed(6); };

  // Mini bar chart
  const BarChart = ({ data }: { data: { label: string; value: number }[] }) => {
    const max = Math.max(...data.map(d => d.value), 1);
    return (
      <div className="flex items-end gap-0.5 sm:gap-1 h-16 sm:h-20">
        {data.map((d, i) => (
          <div key={i} className="flex-1 flex flex-col items-center gap-0.5 sm:gap-1">
            <div className="w-full rounded-t bg-emerald-500/30 min-h-[2px] transition-all duration-500"
              style={{ height: `${(d.value / max) * 100}%` }} />
            <span className="text-[8px] sm:text-[9px] text-slate-600 truncate w-full text-center">{d.label}</span>
          </div>
        ))}
      </div>
    );
  };

  // Copyable field component
  const CopyField = ({ id, label, value, mono = true }: { id: string; label: string; value: string; mono?: boolean }) => (
    <div className="flex flex-col sm:flex-row sm:items-center gap-1.5 sm:gap-3">
      <span className="text-[10px] text-slate-500 uppercase tracking-wider sm:w-20 shrink-0">{label}</span>
      <div className="flex-1 flex items-center gap-2 bg-black/30 rounded-lg px-3 py-2 min-w-0">
        <code className={`text-xs sm:text-sm text-emerald-300 truncate flex-1 ${mono ? 'font-mono' : ''}`}>{value}</code>
        <button onClick={() => copy(id, value)}
          className="text-[10px] text-slate-500 hover:text-emerald-400 transition-colors shrink-0 px-2 py-0.5 rounded bg-white/5 hover:bg-white/10">
          {copiedField === id ? '✓' : 'Copy'}
        </button>
      </div>
    </div>
  );

  // ─── LOGIN ───
  if (!token) {
    return (
      <>
        <div className="mesh-bg" /><div className="noise-overlay" />
        <div className="orb orb-1" /><div className="orb orb-2" />
        <div className="relative z-10 min-h-screen flex items-center justify-center p-4">
          <div className="glass-card p-6 sm:p-8 w-full max-w-md" style={{ animation: 'staggerFade 0.5s ease forwards' }}>
            <div className="text-center mb-6 sm:mb-8">
              <div className="inline-flex items-center gap-2 mb-4">
                <div className="w-3 h-3 rounded-full bg-emerald-500 shadow-lg shadow-emerald-500/50" />
                <span className="text-xs uppercase tracking-[0.3em] text-emerald-400 font-medium">Gateway</span>
              </div>
              <h1 className="text-xl sm:text-2xl font-bold text-white">Clovie Router</h1>
              <p className="text-sm text-slate-500 mt-2">Sign in to manage your API gateway</p>
            </div>
            <div className="space-y-4">
              <input type="text" placeholder="Username" value={username}
                onChange={e => setUsername(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleLogin()}
                className="w-full bg-white/[0.04] border border-white/[0.08] rounded-[10px] px-4 py-3 text-gray-100 outline-none focus:border-emerald-500 focus:shadow-[0_0_0_3px_rgba(16,185,129,0.15)] transition-all"
              />
              <input type="password" placeholder="Password" value={password}
                onChange={e => setPassword(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleLogin()}
                className="w-full bg-white/[0.04] border border-white/[0.08] rounded-[10px] px-4 py-3 text-gray-100 outline-none focus:border-emerald-500 focus:shadow-[0_0_0_3px_rgba(16,185,129,0.15)] transition-all"
              />
              {loginError && <p className="text-red-400 text-sm">{loginError}</p>}
              <button onClick={handleLogin} disabled={loginLoading}
                className="btn-glow w-full disabled:opacity-50">
                {loginLoading ? 'Signing in...' : 'Sign In'}
              </button>
              <p className="text-xs text-slate-600 text-center">Default: admin / clovie2026</p>
            </div>
          </div>
        </div>
      </>
    );
  }

  // ─── DASHBOARD ───
  const statCards = stats ? [
    { label: 'Total Requests', value: fmtNum(stats.totalRequests), color: 'text-emerald-400' },
    { label: 'Requests (24h)', value: fmtNum(stats.requestsLast24h), color: 'text-blue-400' },
    { label: 'Total Tokens', value: fmtNum(stats.totalTokens), color: 'text-purple-400' },
    { label: 'Total Cost', value: '$' + stats.totalCost.toFixed(6), color: 'text-amber-400' },
    { label: 'Cost (24h)', value: '$' + (stats.costLast24h || 0).toFixed(6), color: 'text-yellow-400' },
    { label: 'Active Keys', value: String(stats.activeKeys), color: 'text-green-400' },
  ] : [];

  const tabs: Tab[] = ['overview', 'keys', 'models', 'activity'];

  return (
    <>
      <div className="mesh-bg" /><div className="noise-overlay" />
      <div className="orb orb-1" /><div className="orb orb-2" />
      <div className="relative z-10 min-h-screen">
        {/* Header */}
        <header className="border-b border-white/5 backdrop-blur-xl bg-black/20 sticky top-0 z-20">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 py-3">
            {/* Desktop header */}
            <div className="hidden sm:flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-2.5 h-2.5 rounded-full bg-emerald-500 shadow-lg shadow-emerald-500/50" />
                <h1 className="text-lg font-bold text-white">Clovie Router</h1>
                <span className="text-[10px] bg-emerald-500/10 text-emerald-400 px-2 py-0.5 rounded-full border border-emerald-500/20">v2.0</span>
              </div>
              <div className="flex items-center gap-4">
                <nav className="flex gap-1 bg-white/[0.03] rounded-lg p-1">
                  {tabs.map(t => (
                    <button key={t} onClick={() => setTab(t)}
                      className={`px-3 py-1.5 text-xs rounded-md font-medium transition-all ${
                        tab === t ? 'bg-emerald-500/20 text-emerald-300' : 'text-slate-500 hover:text-slate-300'
                      }`}>
                      {t.charAt(0).toUpperCase() + t.slice(1)}
                    </button>
                  ))}
                </nav>
                <button onClick={logout} className="text-xs text-slate-600 hover:text-red-400 transition-colors">Logout</button>
              </div>
            </div>
            {/* Mobile header */}
            <div className="flex sm:hidden items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-emerald-500 shadow-lg shadow-emerald-500/50" />
                <h1 className="text-base font-bold text-white">Clovie Router</h1>
                <span className="text-[9px] bg-emerald-500/10 text-emerald-400 px-1.5 py-0.5 rounded-full border border-emerald-500/20">v2.0</span>
              </div>
              <button onClick={() => setMobileMenuOpen(!mobileMenuOpen)} className="text-slate-400 hover:text-white p-1">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  {mobileMenuOpen ? (
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  ) : (
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
                  )}
                </svg>
              </button>
            </div>
            {/* Mobile menu */}
            {mobileMenuOpen && (
              <div className="sm:hidden mt-3 pb-2 space-y-2">
                <nav className="flex flex-wrap gap-1.5">
                  {tabs.map(t => (
                    <button key={t} onClick={() => { setTab(t); setMobileMenuOpen(false); }}
                      className={`px-3 py-1.5 text-xs rounded-md font-medium transition-all ${
                        tab === t ? 'bg-emerald-500/20 text-emerald-300' : 'text-slate-500 hover:text-slate-300 bg-white/[0.03]'
                      }`}>
                      {t.charAt(0).toUpperCase() + t.slice(1)}
                    </button>
                  ))}
                </nav>
                <button onClick={logout} className="text-xs text-red-400/70 hover:text-red-400 transition-colors">Logout</button>
              </div>
            )}
          </div>
        </header>

        <main className="max-w-7xl mx-auto px-4 sm:px-6 py-4 sm:py-6 space-y-4 sm:space-y-6">

          {/* ─── OVERVIEW TAB ─── */}
          {tab === 'overview' && <>
            {/* Stat cards */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
              {statCards.map((s, i) => (
                <div key={s.label} className="glass-card p-3 sm:p-5 stagger-in" style={{ animationDelay: `${i * 0.08}s` }}>
                  <p className="text-[9px] sm:text-[10px] text-slate-500 uppercase tracking-wider">{s.label}</p>
                  <p className={`text-lg sm:text-2xl lg:text-3xl font-bold mt-1 ${s.color}`}>{s.value}</p>
                </div>
              ))}
            </div>

            {/* Charts row */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 sm:gap-4">
              <div className="glass-card p-4 sm:p-5 stagger-in" style={{ animationDelay: '0.3s' }}>
                <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3 sm:mb-4">Requests (24h)</h3>
                {stats && (
                  <BarChart data={stats.hourlyRequests.map(h => ({ label: h.hour.slice(11) + 'h', value: h.count }))} />
                )}
              </div>
              <div className="glass-card p-4 sm:p-5 stagger-in" style={{ animationDelay: '0.4s' }}>
                <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3 sm:mb-4">Top Models (24h)</h3>
                <div className="space-y-2">
                  {stats?.modelBreakdown.slice(0, 5).map((m, i) => (
                    <div key={m.model} className="flex items-center gap-2 sm:gap-3">
                      <span className="text-xs text-slate-600 w-4">{i + 1}</span>
                      <div className="flex-1 min-w-0">
                        <div className="flex justify-between items-center">
                          <span className="text-[11px] sm:text-xs text-slate-300 font-mono truncate">{m.model}</span>
                          <span className="text-[10px] sm:text-xs text-slate-500 ml-2">{m.count} req</span>
                        </div>
                        <div className="mt-1 h-1.5 bg-white/5 rounded-full overflow-hidden">
                          <div className="h-full bg-emerald-500/40 rounded-full transition-all duration-700"
                            style={{ width: `${Math.min(100, (m.count / (stats?.modelBreakdown[0]?.count || 1)) * 100)}%` }} />
                        </div>
                      </div>
                    </div>
                  ))}
                  {(!stats || stats.modelBreakdown.length === 0) && <p className="text-xs text-slate-600 text-center py-4">No data yet</p>}
                </div>
              </div>
            </div>

            {/* Per-Key Stats */}
            <div className="stagger-in" style={{ animationDelay: '0.5s' }}>
              <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3 sm:mb-4">Per-Key Stats</h3>
              {keys.length === 0 ? (
                <div className="glass-card p-8 text-center text-slate-600 text-sm">No keys yet</div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  {keys.map((k, idx) => {
                    const keyLogs = stats?.recentActivity.filter(a => {
                      // match by model since we don't have key in usage log — use key's own stats instead
                      return true;
                    }) || [];
                    const isActive = k.enabled;
                    return (
                      <div key={k.key} className="glass-card p-4 hover:bg-white/[0.04] transition-colors" style={{ animationDelay: `${0.5 + idx * 0.05}s` }}>
                        <div className="flex items-center justify-between mb-3">
                          <div className="flex items-center gap-2 min-w-0">
                            <div className={`w-2 h-2 rounded-full shrink-0 ${isActive ? 'bg-green-500 shadow-sm shadow-green-500/50' : 'bg-red-500'}`} />
                            <span className="text-sm font-medium text-white truncate">{k.name}</span>
                          </div>
                          {k.rateLimit > 0 && (
                            <span className="text-[9px] bg-amber-500/10 text-amber-400 px-1.5 py-0.5 rounded border border-amber-500/20 shrink-0">{k.rateLimit}/min</span>
                          )}
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                          <div className="bg-black/20 rounded-lg p-2">
                            <p className="text-[9px] text-slate-600 uppercase">Requests</p>
                            <p className="text-base font-mono text-emerald-400">{fmtNum(k.requestCount)}</p>
                          </div>
                          <div className="bg-black/20 rounded-lg p-2">
                            <p className="text-[9px] text-slate-600 uppercase">Tokens</p>
                            <p className="text-base font-mono text-purple-400">{fmtNum(k.totalTokens)}</p>
                          </div>
                          <div className="bg-black/20 rounded-lg p-2">
                            <p className="text-[9px] text-slate-600 uppercase">Cost</p>
                            <p className="text-base font-mono text-amber-400">${k.totalCost.toFixed(4)}</p>
                          </div>
                          <div className="bg-black/20 rounded-lg p-2">
                            <p className="text-[9px] text-slate-600 uppercase">Last Used</p>
                            <p className="text-xs font-mono text-slate-400 mt-0.5">{k.lastUsed ? fmtTime(k.lastUsed) : '—'}</p>
                          </div>
                        </div>
                        <div className="mt-2 pt-2 border-t border-white/5">
                          <div className="flex items-center gap-2">
                            <span className="text-[9px] text-slate-600 font-mono truncate flex-1">{k.key.slice(0, 20)}...</span>
                            <button onClick={() => copy('k-' + k.key, k.key)} className="text-[9px] text-emerald-400 hover:text-emerald-300">
                              {copiedField === 'k-' + k.key ? '✓' : 'Copy'}
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Recent Activity */}
            <div className="glass-card p-4 sm:p-5 stagger-in" style={{ animationDelay: '0.6s' }}>
              <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3 sm:mb-4">Recent Activity</h3>
              <div className="space-y-1.5 max-h-48 overflow-y-auto">
                {stats?.recentActivity.slice(0, 10).map((a, i) => (
                  <div key={i} className="flex items-center gap-2 sm:gap-3 text-[10px] sm:text-xs py-1">
                    <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${a.status === 200 ? 'bg-green-500' : 'bg-red-500'}`} />
                    <span className="text-slate-500 w-12 sm:w-16">{fmtTime(a.timestamp)}</span>
                    <span className="text-slate-400 font-mono truncate flex-1">{a.model}</span>
                    <span className="text-slate-600 hidden sm:inline">{fmtLatency(a.latencyMs)}</span>
                    <span className="text-slate-600">{fmtNum(a.totalTokens)} tok</span>
                    <span className="text-amber-400/70 font-mono hidden sm:inline">${(a.cost || 0).toFixed(6)}</span>
                  </div>
                ))}
                {(!stats || stats.recentActivity.length === 0) && <p className="text-xs text-slate-600 text-center py-4">No activity yet</p>}
              </div>
            </div>
          </>}

          {/* ─── KEYS TAB ─── */}
          {tab === 'keys' && <>
            {/* Connection info */}
            <div className="glass-card p-4 sm:p-6 stagger-in" style={{ border: '1px solid rgba(99,102,241,0.15)' }}>
              <div className="flex items-center gap-2 mb-3 sm:mb-4">
                <div className="w-2 h-2 rounded-full bg-green-500 shadow-lg shadow-green-500/50" />
                <h2 className="text-xs sm:text-sm font-semibold text-white uppercase tracking-wider">Connection Info</h2>
              </div>
              <p className="text-[11px] sm:text-xs text-slate-500 mb-3 sm:mb-4">
                Paste these into any OpenAI-compatible app. The URL auto-updates when you change domains.
              </p>
              <div className="space-y-3">
                <CopyField id="baseurl" label="Base URL" value={baseUrl} />
                <div className="flex flex-col sm:flex-row sm:items-center gap-1.5 sm:gap-3">
                  <span className="text-[10px] text-slate-500 uppercase tracking-wider sm:w-20 shrink-0">API Key</span>
                  <div className="flex-1 flex items-center gap-2">
                    <select
                      className="flex-1 bg-black/30 border border-white/[0.08] rounded-lg px-3 py-2 text-xs sm:text-sm text-emerald-300 font-mono outline-none focus:border-emerald-500"
                      onChange={e => { if (e.target.value) copy('apikey', e.target.value); }}
                      defaultValue=""
                    >
                      <option value="" disabled>Select a key...</option>
                      {keys.filter(k => k.enabled).map(k => (
                        <option key={k.key} value={k.key}>{k.name} — {k.key.slice(0, 16)}...</option>
                      ))}
                    </select>
                    <span className="text-[10px] text-slate-600 shrink-0">{copiedField === 'apikey' ? '✓ Copied!' : ''}</span>
                  </div>
                </div>
              </div>

              {/* Quick config examples */}
              <div className="mt-4 sm:mt-5 pt-4 border-t border-white/5">
                <p className="text-[10px] text-slate-500 uppercase tracking-wider mb-3">Quick Config</p>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  {[
                    { label: 'OpenAI SDK', code: `from openai import OpenAI\n\nclient = OpenAI(\n  base_url="${baseUrl}",\n  api_key="clovie-xxx"\n)` },
                    { label: '.env', code: `OPENAI_BASE_URL=${baseUrl}\nOPENAI_API_KEY=clovie-xxx` },
                    { label: 'curl', code: `curl ${baseUrl}/chat/completions \\\n  -H "Authorization: Bearer *** \\\n  -H "Content-Type: application/json" \\\n  -d '{"model":"mimo-v2.5-pro",...}'` },
                  ].map(ex => (
                    <div key={ex.label} className="relative group">
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-[10px] text-slate-500">{ex.label}</span>
                        <button onClick={() => copy(ex.label, ex.code)}
                          className="text-[10px] text-slate-600 hover:text-emerald-400 opacity-0 group-hover:opacity-100 transition-all">
                          {copiedField === ex.label ? '✓' : 'copy'}
                        </button>
                      </div>
                      <pre className="bg-black/30 rounded-lg p-2 sm:p-3 text-[10px] sm:text-[11px] text-slate-400 font-mono overflow-x-auto leading-relaxed">{ex.code}</pre>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Create key */}
            <div className="glass-card p-4 sm:p-5 stagger-in" style={{ animationDelay: '0.1s' }}>
              <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3 sm:mb-4">Generate API Key</h2>
              <div className="flex flex-col sm:flex-row gap-2 sm:gap-3">
                <input type="text" placeholder="Key name (e.g. Production, My App)" value={newName}
                  onChange={e => setNewName(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && createKey()}
                  className="flex-1 bg-white/[0.04] border border-white/[0.08] rounded-[10px] px-4 py-2.5 text-sm text-gray-100 outline-none focus:border-emerald-500 transition-all"
                />
                <div className="flex gap-2 sm:gap-3">
                  <input type="number" placeholder="Rate limit/min (0=∞)" value={newRateLimit}
                    onChange={e => setNewRateLimit(e.target.value)}
                    className="flex-1 sm:w-40 bg-white/[0.04] border border-white/[0.08] rounded-[10px] px-4 py-2.5 text-sm text-gray-100 outline-none focus:border-emerald-500 transition-all"
                  />
                  <button onClick={createKey} disabled={loading || !newName.trim()}
                    className="btn-glow disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap text-sm px-4 sm:px-5">
                    {loading ? 'Creating...' : '+ Generate'}
                  </button>
                </div>
              </div>
            </div>

            {/* Keys list */}
            <div className="glass-card overflow-hidden stagger-in" style={{ animationDelay: '0.2s' }}>
              <div className="p-4 sm:p-5 pb-0">
                <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-wider">API Keys ({keys.length})</h2>
              </div>
              {keys.length === 0 ? (
                <div className="p-8 sm:p-12 text-center text-slate-600 text-sm">No keys yet. Generate your first key above.</div>
              ) : (
                <div className="divide-y divide-white/5">
                  {keys.map(k => (
                    <div key={k.key} className="key-row px-4 sm:px-5 py-3 sm:py-3.5 flex items-center gap-3 sm:gap-4 hover:bg-white/[0.02] transition-colors">
                      <div className={`status-dot ${k.enabled ? 'status-active' : 'status-disabled'} hidden sm:block`} />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 sm:gap-3">
                          <span className="font-medium text-white text-xs sm:text-sm truncate">{k.name}</span>
                          {k.rateLimit > 0 && (
                            <span className="text-[9px] sm:text-[10px] bg-amber-500/10 text-amber-400 px-1.5 py-0.5 rounded border border-amber-500/20 shrink-0">{k.rateLimit}/min</span>
                          )}
                          <span className="text-[9px] sm:text-[10px] text-slate-600 hidden sm:inline">{new Date(k.createdAt).toLocaleDateString()}</span>
                        </div>
                        <div className="flex items-center gap-2 mt-1">
                          <span className="key-badge text-[10px] sm:text-xs">{k.key.slice(0, 12)}...{k.key.slice(-6)}</span>
                          <button onClick={() => copy('k-' + k.key, k.key)} className="copy-btn text-[10px] sm:text-xs text-emerald-400">
                            {copiedField === 'k-' + k.key ? '✓' : 'Copy'}
                          </button>
                        </div>
                      </div>
                      <div className="text-right hidden md:block">
                        <p className="text-[10px] text-slate-600">Requests</p>
                        <p className="text-sm sm:text-base font-mono text-slate-300">{fmtNum(k.requestCount)}</p>
                      </div>
                      <div className="text-right hidden lg:block">
                        <p className="text-[10px] text-slate-600">Tokens</p>
                        <p className="text-sm sm:text-base font-mono text-slate-300">{fmtNum(k.totalTokens)}</p>
                      </div>
                      <div className="text-right hidden lg:block">
                        <p className="text-[10px] text-slate-600">Cost</p>
                        <p className="text-sm sm:text-base font-mono text-amber-400/80">${k.totalCost.toFixed(6)}</p>
                      </div>
                      <div className="flex items-center gap-1.5 sm:gap-2">
                        <button onClick={() => toggleKey(k.key)}
                          className={`px-2 py-1 text-[9px] sm:text-[10px] rounded-lg font-medium transition-all ${
                            k.enabled ? 'bg-green-500/10 text-green-400 border border-green-500/20' : 'bg-red-500/10 text-red-400 border border-red-500/20'
                          }`}>{k.enabled ? 'Active' : 'Off'}</button>
                        <button onClick={() => revokeKey(k.key)}
                          className="px-2 py-1 text-[9px] sm:text-[10px] rounded-lg font-medium bg-red-500/10 text-red-400 border border-red-500/20 hover:bg-red-500/20 transition-all">Revoke</button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Supported endpoints */}
            <div className="glass-card p-4 sm:p-5 stagger-in" style={{ animationDelay: '0.3s' }}>
              <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">Supported Endpoints</h2>
              <div className="space-y-2">
                {[
                  { method: 'POST', path: '/v1/chat/completions', desc: 'Chat completions (streaming supported)' },
                  { method: 'GET', path: '/v1/models', desc: 'List available models' },
                ].map(ep => (
                  <div key={ep.path} className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-3 text-xs sm:text-sm">
                    <div className="flex items-center gap-2 sm:gap-3">
                      <span className="text-[10px] sm:text-xs font-mono px-2 py-0.5 rounded bg-green-500/10 text-green-400 border border-green-500/20 w-14 text-center">{ep.method}</span>
                      <span className="font-mono text-slate-300">{ep.path}</span>
                    </div>
                    <span className="text-slate-600 text-[11px] sm:text-xs sm:ml-0">— {ep.desc}</span>
                  </div>
                ))}
              </div>
            </div>
          </>}

          {/* ─── MODELS TAB ─── */}
          {tab === 'models' && <>
            <div className="glass-card p-4 sm:p-5 stagger-in">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4">
                <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Available Models ({models.length})</h2>
                <div className="flex items-center gap-2 sm:gap-3">
                  <input type="text" placeholder="Search models..." value={modelSearch}
                    onChange={e => setModelSearch(e.target.value)}
                    className="flex-1 sm:w-64 bg-white/[0.04] border border-white/[0.08] rounded-lg px-3 py-1.5 text-xs text-gray-100 outline-none focus:border-emerald-500 transition-all"
                  />
                  <button onClick={fetchModels} disabled={modelsLoading}
                    className="text-xs text-emerald-400 hover:text-emerald-300 disabled:opacity-50 shrink-0">
                    {modelsLoading ? 'Loading...' : '↻ Refresh'}
                  </button>
                </div>
              </div>
              {models.length === 0 && !modelsLoading ? (
                <p className="text-xs text-slate-600 text-center py-8">No models loaded. Click Refresh.</p>
              ) : (
                <>
                  {/* Desktop table */}
                  <div className="hidden sm:block overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="border-b border-white/5">
                          <th className="text-left px-4 py-2 text-slate-500 font-medium">Model</th>
                          <th className="text-left px-4 py-2 text-slate-500 font-medium">Modality</th>
                          <th className="text-right px-4 py-2 text-slate-500 font-medium">Context</th>
                          <th className="text-right px-4 py-2 text-slate-500 font-medium">$/1M prompt</th>
                          <th className="text-right px-4 py-2 text-slate-500 font-medium">$/1M completion</th>
                          <th className="text-right px-4 py-2 text-slate-500 font-medium">Copy ID</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-white/[0.03]">
                        {models
                          .filter(m => !modelSearch || m.id.toLowerCase().includes(modelSearch.toLowerCase()) || m.name.toLowerCase().includes(modelSearch.toLowerCase()))
                          .map((m) => (
                          <tr key={m.id} className="hover:bg-white/[0.02] transition-colors">
                            <td className="px-4 py-2">
                              <div>
                                <span className="text-slate-300 font-mono text-xs">{m.id}</span>
                                <p className="text-[10px] text-slate-600 mt-0.5 truncate max-w-[300px]">{m.name}</p>
                              </div>
                            </td>
                            <td className="px-4 py-2">
                              <span className="text-[10px] bg-white/5 text-slate-400 px-2 py-0.5 rounded-full">{m.architecture?.modality || 'text'}</span>
                            </td>
                            <td className="px-4 py-2 text-right text-slate-400 font-mono">{m.context_length ? (m.context_length >= 1000000 ? (m.context_length/1000000).toFixed(0)+'M' : m.context_length >= 1000 ? (m.context_length/1000).toFixed(0)+'K' : m.context_length) : '—'}</td>
                            <td className="px-4 py-2 text-right text-green-400/70 font-mono">{fmtPrice(m.pricing?.prompt)}</td>
                            <td className="px-4 py-2 text-right text-amber-400/70 font-mono">{fmtPrice(m.pricing?.completion)}</td>
                            <td className="px-4 py-2 text-right">
                              <button onClick={() => {navigator.clipboard.writeText(m.id); setCopiedField('m-'+m.id); setTimeout(() => setCopiedField(''), 2000);}}
                                className="text-[10px] text-slate-600 hover:text-emerald-400 transition-colors px-2 py-0.5 rounded bg-white/5 hover:bg-white/10">
                                {copiedField === 'm-'+m.id ? '✓' : 'Copy'}
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {/* Mobile cards */}
                  <div className="sm:hidden space-y-2">
                    {models
                      .filter(m => !modelSearch || m.id.toLowerCase().includes(modelSearch.toLowerCase()) || m.name.toLowerCase().includes(modelSearch.toLowerCase()))
                      .map((m) => (
                      <div key={m.id} className="glass-card p-3 hover:bg-white/[0.04] transition-colors">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0 flex-1">
                            <p className="text-xs text-slate-300 font-mono truncate">{m.id}</p>
                            <p className="text-[10px] text-slate-600 mt-0.5 truncate">{m.name}</p>
                          </div>
                          <button onClick={() => {navigator.clipboard.writeText(m.id); setCopiedField('m-'+m.id); setTimeout(() => setCopiedField(''), 2000);}}
                            className="text-[9px] text-slate-600 hover:text-emerald-400 transition-colors px-1.5 py-0.5 rounded bg-white/5 hover:bg-white/10 shrink-0">
                            {copiedField === 'm-'+m.id ? '✓' : 'Copy'}
                          </button>
                        </div>
                        <div className="flex items-center gap-2 mt-2 flex-wrap">
                          <span className="text-[9px] bg-white/5 text-slate-400 px-1.5 py-0.5 rounded-full">{m.architecture?.modality || 'text'}</span>
                          <span className="text-[9px] text-slate-500 font-mono">{m.context_length ? (m.context_length >= 1000000 ? (m.context_length/1000000).toFixed(0)+'M' : m.context_length >= 1000 ? (m.context_length/1000).toFixed(0)+'K' : m.context_length) : '—'} ctx</span>
                          <span className="text-[9px] text-green-400/70 font-mono">{fmtPrice(m.pricing?.prompt)} in</span>
                          <span className="text-[9px] text-amber-400/70 font-mono">{fmtPrice(m.pricing?.completion)} out</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>
          </>}

          {/* ─── ACTIVITY TAB ─── */}
          {tab === 'activity' && <>
            <div className="glass-card overflow-hidden stagger-in">
              <div className="p-4 sm:p-5 pb-0">
                <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Request Log</h2>
              </div>
              {(!stats || stats.recentActivity.length === 0) ? (
                <div className="p-8 sm:p-12 text-center text-slate-600 text-sm">No requests yet</div>
              ) : (
                <>
                  {/* Desktop table */}
                  <div className="hidden sm:block overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="border-b border-white/5">
                          <th className="text-left px-5 py-2.5 text-slate-500 font-medium">Time</th>
                          <th className="text-left px-5 py-2.5 text-slate-500 font-medium">Status</th>
                          <th className="text-left px-5 py-2.5 text-slate-500 font-medium">Model</th>
                          <th className="text-right px-5 py-2.5 text-slate-500 font-medium">Prompt</th>
                          <th className="text-right px-5 py-2.5 text-slate-500 font-medium">Completion</th>
                          <th className="text-right px-5 py-2.5 text-slate-500 font-medium">Total</th>
                          <th className="text-right px-5 py-2.5 text-slate-500 font-medium">Latency</th>
                          <th className="text-right px-5 py-2.5 text-slate-500 font-medium">Cost</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-white/[0.03]">
                        {stats.recentActivity.map((a, i) => (
                          <tr key={i} className="hover:bg-white/[0.02] transition-colors">
                            <td className="px-5 py-2 text-slate-500 font-mono">{fmtTime(a.timestamp)}</td>
                            <td className="px-5 py-2">
                              <span className={`inline-flex items-center gap-1.5 ${a.status === 200 ? 'text-green-400' : 'text-red-400'}`}>
                                <span className={`w-1.5 h-1.5 rounded-full ${a.status === 200 ? 'bg-green-500' : 'bg-red-500'}`} />
                                {a.status}
                              </span>
                            </td>
                            <td className="px-5 py-2 text-slate-400 font-mono max-w-[200px] truncate">{a.model}</td>
                            <td className="px-5 py-2 text-right text-slate-400 font-mono">{fmtNum(a.promptTokens)}</td>
                            <td className="px-5 py-2 text-right text-slate-400 font-mono">{fmtNum(a.completionTokens)}</td>
                            <td className="px-5 py-2 text-right text-slate-300 font-mono font-medium">{fmtNum(a.totalTokens)}</td>
                            <td className="px-5 py-2 text-right text-slate-500 font-mono">{fmtLatency(a.latencyMs)}</td>
                            <td className="px-5 py-2 text-right text-amber-400/80 font-mono">${(a.cost || 0).toFixed(6)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {/* Mobile cards */}
                  <div className="sm:hidden space-y-1.5 p-4">
                    {stats.recentActivity.map((a, i) => (
                      <div key={i} className="glass-card p-2.5 hover:bg-white/[0.04] transition-colors">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <span className={`w-1.5 h-1.5 rounded-full ${a.status === 200 ? 'bg-green-500' : 'bg-red-500'}`} />
                            <span className="text-[10px] text-slate-500 font-mono">{fmtTime(a.timestamp)}</span>
                            <span className={`text-[10px] font-mono ${a.status === 200 ? 'text-green-400' : 'text-red-400'}`}>{a.status}</span>
                          </div>
                          <span className="text-[10px] text-amber-400/80 font-mono">${(a.cost || 0).toFixed(6)}</span>
                        </div>
                        <p className="text-[10px] text-slate-400 font-mono truncate mt-1">{a.model}</p>
                        <div className="flex items-center gap-3 mt-1 text-[9px] text-slate-500">
                          <span>{fmtNum(a.promptTokens)} in</span>
                          <span>{fmtNum(a.completionTokens)} out</span>
                          <span>{fmtNum(a.totalTokens)} total</span>
                          <span>{fmtLatency(a.latencyMs)}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>
          </>}

          <footer className="text-center py-4 sm:py-6 text-[9px] sm:text-[10px] text-slate-700">
            Clovie Router v2.0 — JWT Auth + Usage Monitoring — Proxies to {process.env.NEXT_PUBLIC_UPSTREAM || 'opengateway.gitlawb.com'}
          </footer>
        </main>
      </div>
    </>
  );
}
