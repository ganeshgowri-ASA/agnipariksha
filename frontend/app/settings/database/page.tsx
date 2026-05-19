'use client';

/**
 * /settings/database — DB connector configuration UI.
 *
 * Surfaces the backend connectors layer (see `backend/app/database/`):
 *   - Pick from SQLite / Postgres / MySQL / SQL Server / MS Access (or
 *     a custom SQLAlchemy URL).
 *   - "Test Connection" returns latency + server_version.
 *   - "Save" persists the encrypted DSN (Fernet, key in OS keyring).
 *   - "Migrate & Switch" runs alembic upgrade + atomic data copy,
 *     swaps the process DATABASE_URL on success.
 *
 * Passwords never leave the page back to the client — the API returns
 * a redacted preview.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Check, Database, Loader2, ShieldCheck } from 'lucide-react';
import AppShell from '@/components/AppShell';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/States';

interface BackendSpec {
  key: string;
  label: string;
  scheme: string;
  example: string;
  requires: string[];
  notes: string;
}

interface CurrentResponse {
  backend: string;
  label: string;
  url_preview: string;
  updated_at: string;
  process_url_preview: string;
  last_test: TestResult | Record<string, never>;
  supported: BackendSpec[];
}

interface TestResult {
  ok: boolean;
  latency_ms: number | null;
  server_version: string | null;
  error: string | null;
  backend: string | null;
  url_preview?: string;
}

interface SwitchResult {
  ok: boolean;
  tested: boolean;
  alembic: string | null;
  rows_copied: Record<string, number>;
  rolled_back: boolean;
  error: string | null;
  url_preview: string;
}

const API_BASE = process.env.NEXT_PUBLIC_BACKEND_HTTP_URL ?? 'http://localhost:8000';

export default function DatabaseSettingsPage() {
  const [current, setCurrent] = useState<CurrentResponse | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const [backend, setBackend] = useState('sqlite');
  const [label, setLabel] = useState('Local SQLite');
  const [url, setUrl] = useState('sqlite:///./data/agnipariksha.db');

  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<TestResult | null>(null);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [switching, setSwitching] = useState(false);
  const [switchResult, setSwitchResult] = useState<SwitchResult | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const r = await fetch(`${API_BASE}/api/settings/database`, { cache: 'no-store' });
      if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
      const body: CurrentResponse = await r.json();
      setCurrent(body);
      setBackend(body.backend || 'sqlite');
      setLabel(body.label || 'Local SQLite');
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const selectedBackend = useMemo(
    () => current?.supported.find((b) => b.key === backend) ?? null,
    [current, backend],
  );

  const setBackendAndPrefill = (key: string) => {
    setBackend(key);
    const spec = current?.supported.find((b) => b.key === key);
    if (spec) {
      setUrl(spec.example);
      setLabel(spec.label);
    }
    setTestResult(null);
    setSwitchResult(null);
  };

  const onTest = async () => {
    setTesting(true);
    setTestResult(null);
    setErr(null);
    try {
      const r = await fetch(`${API_BASE}/api/settings/database/test`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
      });
      const body: TestResult = await r.json();
      setTestResult(body);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setTesting(false);
    }
  };

  const onSave = async (skipTest = false) => {
    setSaving(true);
    setErr(null);
    try {
      const r = await fetch(`${API_BASE}/api/settings/database/save`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ backend, label, url, skip_test: skipTest }),
      });
      if (!r.ok) {
        const body = await r.json().catch(() => ({}));
        throw new Error(body?.detail?.error ?? `${r.status} ${r.statusText}`);
      }
      const body = await r.json();
      setSavedAt(new Date().toISOString());
      if (body.last_test) setTestResult(body.last_test);
      await refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  const onSwitch = async (dryRun: boolean) => {
    setSwitching(true);
    setSwitchResult(null);
    setErr(null);
    try {
      const r = await fetch(`${API_BASE}/api/settings/database/switch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ backend, label, url, dry_run: dryRun }),
      });
      const body: SwitchResult = await r.json();
      setSwitchResult(body);
      if (body.ok && !dryRun) await refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setSwitching(false);
    }
  };

  return (
    <AppShell
      title="Database settings"
      subtitle="SQLite default · Postgres / MySQL / SQL Server / MS Access via SQLAlchemy. Secrets are Fernet-encrypted in the OS keyring."
    >
      <div className="p-6 max-w-3xl mx-auto space-y-6" data-testid="db-settings-root">
        {loading && <LoadingState title="Loading database settings…" />}
        {loadError && <ErrorState error={loadError} onRetry={refresh} />}
        {!loading && !loadError && current && (
          <>
            {/* Current */}
            <section className="border border-app rounded bg-surface p-4">
              <h3 className="text-sm font-bold text-app mb-3 inline-flex items-center gap-2">
                <Database className="w-4 h-4" /> Current connection
              </h3>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div><span className="text-muted">Backend:</span> <span className="font-mono text-app">{current.backend}</span></div>
                <div><span className="text-muted">Label:</span> <span className="text-app">{current.label}</span></div>
                <div className="col-span-2"><span className="text-muted">Persisted URL:</span> <code className="font-mono text-app">{current.url_preview}</code></div>
                <div className="col-span-2"><span className="text-muted">Process URL:</span> <code className="font-mono text-app">{current.process_url_preview}</code></div>
                {current.updated_at && (
                  <div className="col-span-2"><span className="text-muted">Updated:</span> <span className="text-app">{current.updated_at}</span></div>
                )}
              </div>
            </section>

            {/* Backend picker */}
            <section className="border border-app rounded bg-surface p-4">
              <h3 className="text-sm font-bold text-app mb-3">Select backend</h3>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                {current.supported.map((b) => (
                  <button
                    key={b.key}
                    type="button"
                    onClick={() => setBackendAndPrefill(b.key)}
                    data-testid={`backend-${b.key}`}
                    className={`text-left px-3 py-2 rounded border text-xs transition-colors ${
                      b.key === backend
                        ? 'border-orange-500/70 bg-orange-900/20 text-app'
                        : 'border-app bg-surface-2 text-muted hover:text-app hover:border-orange-700/40'
                    }`}
                  >
                    <div className="font-semibold">{b.label}</div>
                    <div className="text-[10px] font-mono text-muted truncate">{b.scheme}</div>
                  </button>
                ))}
              </div>
              {selectedBackend?.notes && (
                <p className="text-[11px] text-muted mt-2">{selectedBackend.notes}</p>
              )}
              {selectedBackend?.requires.length ? (
                <p className="text-[11px] text-yellow-300 mt-1">
                  Requires Python deps: <code className="font-mono">{selectedBackend.requires.join(', ')}</code>
                </p>
              ) : null}
            </section>

            {/* DSN editor */}
            <section className="border border-app rounded bg-surface p-4 space-y-3">
              <h3 className="text-sm font-bold text-app">Connection details</h3>
              <label className="flex flex-col text-xs text-muted">
                <span className="mb-1">Label</span>
                <input
                  value={label}
                  onChange={(e) => setLabel(e.target.value)}
                  className="bg-surface-2 border border-app rounded px-2 py-1.5 text-app font-mono"
                  data-testid="db-label"
                />
              </label>
              <label className="flex flex-col text-xs text-muted">
                <span className="mb-1">SQLAlchemy URL <span className="text-muted">(secrets are encrypted at rest)</span></span>
                <input
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  spellCheck={false}
                  autoComplete="off"
                  className="bg-surface-2 border border-app rounded px-2 py-1.5 text-app font-mono break-all"
                  data-testid="db-url"
                />
              </label>

              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={onTest}
                  disabled={testing}
                  data-testid="db-test"
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded bg-blue-700 hover:bg-blue-600 disabled:bg-gray-700 text-white text-xs font-semibold"
                >
                  {testing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ShieldCheck className="w-3.5 h-3.5" />} Test connection
                </button>
                <button
                  type="button"
                  onClick={() => onSave(false)}
                  disabled={saving}
                  data-testid="db-save"
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded bg-orange-600 hover:bg-orange-500 disabled:bg-gray-700 text-white text-xs font-semibold"
                >
                  {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />} Save (test first)
                </button>
                <button
                  type="button"
                  onClick={() => onSave(true)}
                  disabled={saving}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded bg-gray-700 hover:bg-gray-600 disabled:bg-gray-800 text-white text-xs font-semibold"
                >
                  Save (skip test)
                </button>
                <button
                  type="button"
                  onClick={() => onSwitch(true)}
                  disabled={switching}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded bg-gray-700 hover:bg-gray-600 disabled:bg-gray-800 text-white text-xs font-semibold"
                >
                  Dry-run migrate
                </button>
                <button
                  type="button"
                  onClick={() => onSwitch(false)}
                  disabled={switching}
                  data-testid="db-switch"
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded bg-red-700 hover:bg-red-600 disabled:bg-gray-800 text-white text-xs font-semibold"
                >
                  Migrate &amp; switch
                </button>
              </div>

              {savedAt && (
                <p className="text-[11px] text-green-300">Saved at {savedAt}.</p>
              )}
              {err && (
                <ErrorState error={err} />
              )}
            </section>

            {/* Test result */}
            <section className="border border-app rounded bg-surface p-4">
              <h3 className="text-sm font-bold text-app mb-3">Last test</h3>
              {testResult == null ? (
                <EmptyState title="No test run yet" description="Click Test connection to probe the URL above." />
              ) : (
                <div className="text-xs space-y-1">
                  <p className={testResult.ok ? 'text-green-300' : 'text-red-300'}>
                    {testResult.ok ? <Check className="w-3 h-3 inline" /> : <AlertTriangle className="w-3 h-3 inline" />} {testResult.ok ? 'Connected' : 'Failed'}
                  </p>
                  <p><span className="text-muted">Backend:</span> <span className="font-mono">{testResult.backend ?? '—'}</span></p>
                  <p><span className="text-muted">Latency:</span> <span className="font-mono">{testResult.latency_ms ?? '—'} ms</span></p>
                  <p><span className="text-muted">Server version:</span> <span className="font-mono break-all">{testResult.server_version ?? '—'}</span></p>
                  {testResult.error && <p className="text-red-300">{testResult.error}</p>}
                </div>
              )}
            </section>

            {/* Switch result */}
            {switchResult && (
              <section className="border border-app rounded bg-surface p-4">
                <h3 className="text-sm font-bold text-app mb-3">Migrate &amp; switch result</h3>
                <div className="text-xs space-y-1">
                  <p className={switchResult.ok ? 'text-green-300' : 'text-red-300'}>
                    {switchResult.ok ? 'Migration applied' : 'Migration failed'}
                  </p>
                  <p><span className="text-muted">Tested:</span> {String(switchResult.tested)}</p>
                  <p><span className="text-muted">Alembic:</span> {switchResult.alembic ?? '—'}</p>
                  <p><span className="text-muted">Rolled back:</span> {String(switchResult.rolled_back)}</p>
                  {switchResult.error && <p className="text-red-300">{switchResult.error}</p>}
                  {Object.keys(switchResult.rows_copied).length > 0 && (
                    <div className="pt-1">
                      <p className="text-muted mb-0.5">Rows copied:</p>
                      <ul className="font-mono text-[11px] pl-3">
                        {Object.entries(switchResult.rows_copied).map(([k, v]) => (
                          <li key={k}>{k}: {v}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              </section>
            )}
          </>
        )}
      </div>
    </AppShell>
  );
}
