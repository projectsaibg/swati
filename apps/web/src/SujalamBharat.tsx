import { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import {
  SujalamOverview, FieldMappingRow, ValidationRuleRow, MapPreview, ValidationReport, SujalamGis,
  SyncJobs, ConflictRow, SyncResult, ImportResult, MyAccess,
  ReadinessReport, SyncActivityReport, JjmMigrationReport, RoleMappingRow, ClassificationSummary, api,
} from './api';
import { useAuth } from './contexts';

function classify(field: string, cls: ClassificationSummary | null): 'PUBLIC' | 'INTERNAL' | 'SENSITIVE' {
  if (!cls) return 'PUBLIC';
  if (cls.sensitive.includes(field)) return 'SENSITIVE';
  if (cls.internal.includes(field)) return 'INTERNAL';
  return 'PUBLIC';
}
const CLASS_PILL: Record<string, string> = { PUBLIC: '', INTERNAL: 'watch', SENSITIVE: 'alarm' };

const DISTRICTS = ['ALL', 'Nadia', 'Purba Medinipur'];
type ReportType = 'readiness' | 'sync-activity' | 'jjm-migration' | 'access-matrix';

// The official Sujalam Bharat user types (from the public app's "Select User type"),
// shown for reference in the access matrix so SWATI roles map onto real roles.
const OFFICIAL_USER_TYPES = [
  'NJJM User', 'State Level Officer', 'District Level Officer', 'Divisional Office',
  'State Level Link Officer', 'District Level Link Officer', 'Third Party Inspection Agency User',
  'Designated Implementing Agency Nodal',
];

const SYS_LABEL: Record<string, string> = {
  SUJALAM_BHARAT: 'Sujalam Bharat',
  JJM_1_0: 'JJM 1.0 (legacy)',
};
const STATUS_COLOR: Record<string, string> = {
  SYNCED: 'var(--ok)',
  READY_FOR_SYNC: 'var(--ok)',
  IN_PROGRESS: 'var(--watch)',
  VALIDATION_PENDING: 'var(--watch)',
  NOT_MAPPED: 'var(--muted)',
  SUSPENDED: 'var(--muted)',
  CONFLICT: 'var(--alarm)',
  SYNC_FAILED: 'var(--alarm)',
};
const SYSTEMS = ['SUJALAM_BHARAT', 'JJM_1_0'] as const;
const ENTITY_TYPES: { key: string; label: string }[] = [
  { key: 'SCHEME', label: 'Schemes' },
  { key: 'SERVICE_AREA', label: 'Service areas' },
  { key: 'SUJAL_GAON', label: 'Sujal Gaon villages' },
  { key: 'INFRASTRUCTURE', label: 'Infrastructure' },
];

function readinessColor(pct: number): string {
  return pct >= 80 ? 'var(--ok)' : pct >= 40 ? 'var(--watch)' : 'var(--alarm)';
}
function fmtVal(v: unknown): string {
  if (v === null || v === undefined) return '—';
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

type Tab = 'overview' | 'mapping' | 'validation' | 'gis' | 'sync' | 'reports';

export function SujalamBharat() {
  const { user } = useAuth();
  const [tab, setTab] = useState<Tab>('overview');
  const [system, setSystem] = useState<string>('SUJALAM_BHARAT');
  const [entityType, setEntityType] = useState<string>('SCHEME');
  const [err, setErr] = useState('');

  const [ov, setOv] = useState<SujalamOverview | null>(null);
  const [mappings, setMappings] = useState<FieldMappingRow[]>([]);
  const [preview, setPreview] = useState<MapPreview | null>(null);
  const [rules, setRules] = useState<ValidationRuleRow[]>([]);
  const [report, setReport] = useState<ValidationReport | null>(null);
  const [gis, setGis] = useState<SujalamGis | null>(null);
  const [jobs, setJobs] = useState<SyncJobs | null>(null);
  const [conflicts, setConflicts] = useState<ConflictRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [actionMsg, setActionMsg] = useState('');
  const [access, setAccess] = useState<MyAccess | null>(null);
  const [reportType, setReportType] = useState<ReportType>('readiness');
  const [reportDistrict, setReportDistrict] = useState('ALL');
  const [readiness, setReadiness] = useState<ReadinessReport | null>(null);
  const [syncActivity, setSyncActivity] = useState<SyncActivityReport | null>(null);
  const [jjmReport, setJjmReport] = useState<JjmMigrationReport | null>(null);
  const [roleMappings, setRoleMappings] = useState<RoleMappingRow[]>([]);
  const [classification, setClassification] = useState<ClassificationSummary | null>(null);

  useEffect(() => {
    api.sujalamOverview().then(setOv).catch(() => setErr('Could not load Sujalam Bharat integration data.'));
    api.sujalamClassification().then(setClassification).catch(() => {});
  }, []);

  // RBAC: resolve the current user's integration capabilities (re-runs on login).
  useEffect(() => { api.sujalamMyAccess().then(setAccess).catch(() => setAccess(null)); }, [user]);

  useEffect(() => {
    if (tab !== 'reports') return;
    setErr('');
    if (reportType === 'readiness') api.sujalamReadiness(reportDistrict).then(setReadiness).catch(() => setErr('Could not load report.'));
    else if (reportType === 'sync-activity') api.sujalamSyncActivity().then(setSyncActivity).catch(() => setErr('Could not load report.'));
    else if (reportType === 'jjm-migration') api.sujalamJjmMigration().then(setJjmReport).catch(() => setErr('Could not load report.'));
    else if (reportType === 'access-matrix') api.sujalamRoleMappings().then(setRoleMappings).catch(() => setErr('Could not load report.'));
  }, [tab, reportType, reportDistrict]);

  useEffect(() => {
    if (tab !== 'gis' || gis) return;
    api.sujalamGis().then(setGis).catch(() => setErr('Could not load GIS data.'));
  }, [tab, gis]);

  const refreshSync = () => {
    Promise.all([api.sujalamSyncJobs(), api.sujalamConflicts()])
      .then(([j, c]) => { setJobs(j); setConflicts(c); })
      .catch(() => setErr('Could not load sync data.'));
  };
  useEffect(() => { if (tab === 'sync') refreshSync(); }, [tab]);

  const runAction = async (label: string, fn: () => Promise<SyncResult | ImportResult>) => {
    setBusy(true); setActionMsg(''); setErr('');
    try {
      const r = await fn();
      const parts = Object.entries(r).filter(([k]) => !['jobId', 'batchId', 'mock', 'system', 'direction', 'entityType'].includes(k));
      setActionMsg(`${label}: ` + parts.map(([k, v]) => `${k} ${v}`).join(', '));
      refreshSync();
      api.sujalamOverview().then(setOv).catch(() => {});
    } catch {
      setErr(`${label} failed. ${user ? 'Please try again.' : 'Sign in to run sync actions.'}`);
    } finally {
      setBusy(false);
    }
  };
  const resolve = async (id: string, resolution: 'INTERNAL' | 'EXTERNAL') => {
    setBusy(true); setErr('');
    try { await api.sujalamResolveConflict(id, resolution); refreshSync(); api.sujalamOverview().then(setOv).catch(() => {}); }
    catch { setErr('Could not resolve the conflict.'); }
    finally { setBusy(false); }
  };

  useEffect(() => {
    if (tab !== 'mapping') return;
    setErr('');
    Promise.all([api.sujalamFieldMappings(system, entityType), api.sujalamMapPreview(system, entityType)])
      .then(([m, p]) => { setMappings(m); setPreview(p); })
      .catch(() => setErr('Could not load field mappings.'));
  }, [tab, system, entityType]);

  useEffect(() => {
    if (tab !== 'validation') return;
    setErr('');
    Promise.all([api.sujalamValidationRules(system, entityType), api.sujalamValidationReport(system, entityType)])
      .then(([r, rep]) => { setRules(r); setReport(rep); })
      .catch(() => setErr('Could not load validation report.'));
  }, [tab, system, entityType]);

  const tabBtn = (t: Tab, label: string) => (
    <button
      key={t}
      onClick={() => setTab(t)}
      className={`pill ${tab === t ? 'ok' : ''}`}
      style={{ cursor: 'pointer', border: '1px solid var(--border, #2a2a3a)', background: tab === t ? undefined : 'transparent', color: tab === t ? undefined : 'var(--muted)', padding: '6px 14px' }}
    >
      {label}
    </button>
  );

  return (
    <div>
      <div className="exec-head">
        <div>
          <h1 className="exec-title" style={{ fontSize: 26 }}>SUJALAM BHARAT INTEGRATION</h1>
          <p className="exec-sub">Government scheme &amp; asset ID mapping, field/schema mapping, validation and readiness</p>
        </div>
        <div className="statuspills">
          <span className="spill" style={{ color: 'var(--watch)', borderColor: 'var(--watch)' }}>DEMO / MOCK</span>
        </div>
      </div>

      {err && <div className="err">{err}</div>}

      {/* Demo / mock banner */}
      <div className="panel" style={{ marginBottom: 12, borderLeft: '3px solid var(--watch)' }}>
        <strong style={{ color: 'var(--watch)' }}>Demonstration data — not a government system.</strong>
        <p className="muted" style={{ margin: '6px 0 0', maxWidth: 780 }}>
          {ov?.disclaimer ??
            'SWATI is architecturally prepared for Sujalam Bharat integration. Official production integration is subject to government API specifications, authorization, credentials, security requirements and data-sharing protocols.'}
        </p>
      </div>

      {/* Tab bar */}
      <div className="panel" style={{ marginBottom: 12, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        {tabBtn('overview', 'Overview')}
        {tabBtn('mapping', 'Field Mapping')}
        {tabBtn('validation', 'Validation')}
        {tabBtn('gis', 'GIS Map')}
        {tabBtn('sync', 'Sync')}
        {tabBtn('reports', 'Reports')}
        {(tab === 'mapping' || tab === 'validation' || tab === 'sync') && (
          <span style={{ display: 'inline-flex', gap: 8, marginLeft: 'auto', flexWrap: 'wrap' }}>
            <select className="input" value={system} onChange={(e) => setSystem(e.target.value)}>
              {SYSTEMS.map((s) => <option key={s} value={s}>{SYS_LABEL[s]}</option>)}
            </select>
            <select className="input" value={entityType} onChange={(e) => setEntityType(e.target.value)}>
              {ENTITY_TYPES.map((e) => <option key={e.key} value={e.key}>{e.label}</option>)}
            </select>
          </span>
        )}
      </div>

      {tab === 'overview' && <OverviewTab ov={ov} />}
      {tab === 'mapping' && <MappingTab mappings={mappings} preview={preview} classification={classification} authed={!!user} />}
      {tab === 'validation' && <ValidationTab rules={rules} report={report} />}
      {tab === 'gis' && <GisTab gis={gis} />}
      {tab === 'sync' && (
        <SyncTab
          jobs={jobs} conflicts={conflicts} busy={busy} actionMsg={actionMsg} access={access} loggedIn={!!user}
          onPush={() => runAction('Push', () => api.sujalamPush(system, entityType))}
          onPull={() => runAction('Pull', () => api.sujalamPull(system, entityType))}
          onImport={() => runAction('JJM import', () => api.sujalamImportJjm())}
          onResolve={resolve}
        />
      )}
      {tab === 'reports' && (
        <ReportsTab
          reportType={reportType} setReportType={setReportType}
          district={reportDistrict} setDistrict={setReportDistrict}
          readiness={readiness} syncActivity={syncActivity} jjm={jjmReport} roleMappings={roleMappings}
        />
      )}
    </div>
  );
}

function SyncTab({ jobs, conflicts, busy, actionMsg, access, loggedIn, onPush, onPull, onImport, onResolve }: {
  jobs: SyncJobs | null; conflicts: ConflictRow[]; busy: boolean; actionMsg: string;
  access: MyAccess | null; loggedIn: boolean;
  onPush: () => void; onPull: () => void; onImport: () => void;
  onResolve: (id: string, resolution: 'INTERNAL' | 'EXTERNAL') => void;
}) {
  const fmtDate = (s: string | null) => (s ? new Date(s).toLocaleString() : '—');
  const stateColor = (s: string) => (s === 'SUCCESS' ? 'ok' : s === 'PARTIAL' ? 'watch' : s === 'FAILED' ? 'alarm' : 'watch');
  const btn = (allowed: boolean) => ({ cursor: allowed && !busy ? 'pointer' : 'default', padding: '8px 16px', border: '1px solid var(--line)', opacity: allowed && !busy ? 1 : 0.5 } as const);
  const canPush = !!access?.canPush, canPull = !!access?.canPull, canImport = !!access?.canImport, canResolve = !!access?.canResolve;
  return (
    <>
      <div className="panel" style={{ marginBottom: 12 }}>
        <h3 style={{ marginTop: 0 }}>Run sync <span className="muted" style={{ fontSize: 13, fontWeight: 400 }}>· mock bidirectional sync + legacy import</span></h3>
        {!loggedIn && <div className="cc-legend row" style={{ fontSize: 12, marginBottom: 10 }}><span style={{ color: 'var(--watch)' }}>Sign in to run sync actions (public users can view history and conflicts).</span></div>}
        {loggedIn && access && (
          <div className="cc-legend row" style={{ fontSize: 12, marginBottom: 10 }}>
            <span className="muted">Acting as <strong>{access.roleName ?? '—'}</strong>
              {access.externalRole && <> → {access.externalRole}</>} · scope <strong>{access.geoScope}</strong>
              {!access.mapped && <span style={{ color: 'var(--alarm)' }}> · no integration role mapping (no capabilities)</span>}
            </span>
          </div>
        )}
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <button className="pill ok" style={btn(canPush)} disabled={!canPush || busy} onClick={onPush} title={canPush ? '' : 'Your role cannot push'}>Push to provider →</button>
          <button className="pill" style={btn(canPull)} disabled={!canPull || busy} onClick={onPull} title={canPull ? '' : 'Your role cannot pull'}>← Pull from provider</button>
          <button className="pill" style={btn(canImport)} disabled={!canImport || busy} onClick={onImport} title={canImport ? '' : 'Your role cannot import'}>Import from JJM 1.0</button>
        </div>
        {actionMsg && <p className="muted" style={{ marginBottom: 0, marginTop: 10, fontSize: 13 }}>{actionMsg}</p>}
      </div>

      <div className="panel" style={{ marginBottom: 12 }}>
        <h3 style={{ marginTop: 0 }}>Open conflicts <span className="muted" style={{ fontSize: 13, fontWeight: 400 }}>· from pull ({conflicts.length})</span></h3>
        <table className="tbl">
          <thead><tr><th>Entity</th><th>Field</th><th>SWATI value</th><th>Provider value</th><th>Resolve</th></tr></thead>
          <tbody>
            {conflicts.map((c) => (
              <tr key={c.id}>
                <td>{c.label ?? c.internalEntityId} <span className="muted" style={{ fontSize: 11 }}>({c.entityType})</span></td>
                <td className="tnum">{c.field}</td>
                <td className="tnum">{String(c.internalValue ?? '—')}</td>
                <td className="tnum" style={{ color: 'var(--watch)' }}>{String(c.externalValue ?? '—')}</td>
                <td style={{ display: 'flex', gap: 6 }}>
                  <button className="pill" style={{ cursor: canResolve && !busy ? 'pointer' : 'default', border: '1px solid var(--line)', opacity: canResolve && !busy ? 1 : 0.5 }} disabled={!canResolve || busy} onClick={() => onResolve(c.id, 'INTERNAL')}>Keep SWATI</button>
                  <button className="pill watch" style={{ cursor: canResolve && !busy ? 'pointer' : 'default', opacity: canResolve && !busy ? 1 : 0.5 }} disabled={!canResolve || busy} onClick={() => onResolve(c.id, 'EXTERNAL')}>Take provider</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {conflicts.length === 0 && <p className="muted">No open conflicts. Run a pull to check for government-side changes.</p>}
      </div>

      <div className="panel" style={{ marginBottom: 12 }}>
        <h3 style={{ marginTop: 0 }}>Sync history</h3>
        <table className="tbl">
          <thead><tr><th>Provider</th><th>Direction</th><th>Entity</th><th>State</th><th>OK</th><th>Failed</th><th>Conflicts/Rejected</th><th>When</th></tr></thead>
          <tbody>
            {(jobs?.syncJobs ?? []).map((j) => (
              <tr key={j.id}>
                <td>{SYS_LABEL[j.provider] ?? j.provider}</td>
                <td className="tnum">{j.direction}</td>
                <td className="muted">{j.entityType ?? '—'}</td>
                <td><span className={`pill ${stateColor(j.state)}`}>{j.state}</span></td>
                <td className="tnum" style={{ color: 'var(--ok)' }}>{j.success}</td>
                <td className="tnum" style={{ color: j.failed ? 'var(--alarm)' : undefined }}>{j.failed}</td>
                <td className="tnum" style={{ color: j.rejected ? 'var(--watch)' : undefined }}>{j.rejected}</td>
                <td className="muted" style={{ fontSize: 12 }}>{fmtDate(j.startedAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {(!jobs || jobs.syncJobs.length === 0) && <p className="muted">No sync jobs yet.</p>}
      </div>

      <div className="panel">
        <h3 style={{ marginTop: 0 }}>JJM 1.0 legacy imports</h3>
        <table className="tbl">
          <thead><tr><th>Batch</th><th>State</th><th>Total</th><th>Created</th><th>Linked</th><th>Skipped</th><th>When</th></tr></thead>
          <tbody>
            {(jobs?.legacyImports ?? []).map((l) => (
              <tr key={l.id}>
                <td>{l.batchLabel}</td>
                <td><span className={`pill ${stateColor(l.state)}`}>{l.state}</span></td>
                <td className="tnum">{l.total}</td>
                <td className="tnum" style={{ color: 'var(--ok)' }}>{l.created}</td>
                <td className="tnum">{l.linked}</td>
                <td className="tnum muted">{l.skipped}</td>
                <td className="muted" style={{ fontSize: 12 }}>{fmtDate(l.startedAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {(!jobs || jobs.legacyImports.length === 0) && <p className="muted">No legacy imports yet.</p>}
      </div>
    </>
  );
}

const REPORT_TYPES: { key: ReportType; label: string }[] = [
  { key: 'readiness', label: 'Integration readiness' },
  { key: 'sync-activity', label: 'Sync activity' },
  { key: 'jjm-migration', label: 'JJM 1.0 migration' },
  { key: 'access-matrix', label: 'Access matrix (RBAC)' },
];

function pctColor(p: number): string {
  return p >= 80 ? 'var(--ok)' : p >= 40 ? 'var(--watch)' : 'var(--alarm)';
}
const yn = (b: boolean) => (b ? <span style={{ color: 'var(--ok)' }}>✓</span> : <span className="muted">—</span>);

function ReportsTab({ reportType, setReportType, district, setDistrict, readiness, syncActivity, jjm, roleMappings }: {
  reportType: ReportType; setReportType: (t: ReportType) => void;
  district: string; setDistrict: (d: string) => void;
  readiness: ReadinessReport | null; syncActivity: SyncActivityReport | null;
  jjm: JjmMigrationReport | null; roleMappings: RoleMappingRow[];
}) {
  const fmtDate = (s: string | null) => (s ? new Date(s).toLocaleString() : '—');
  return (
    <>
      <div className="panel" style={{ marginBottom: 12, display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
        <select className="input" value={reportType} onChange={(e) => setReportType(e.target.value as ReportType)}>
          {REPORT_TYPES.map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}
        </select>
        {reportType === 'readiness' && (
          <select className="input" value={district} onChange={(e) => setDistrict(e.target.value)}>
            {DISTRICTS.map((d) => <option key={d} value={d}>{d === 'ALL' ? 'All districts' : d}</option>)}
          </select>
        )}
        <span className="muted" style={{ fontSize: 12 }}>Demonstration report — not an official government document.</span>
      </div>

      {reportType === 'readiness' && (
        <>
          <section className="kpi-grid" style={{ marginBottom: 14 }}>
            <div className="kpi"><div className="val tnum" style={{ color: readiness ? pctColor(readiness.overallReadinessPct) : undefined }}>{readiness ? `${readiness.overallReadinessPct}%` : '—'}</div><div className="lbl">Overall readiness ({readiness?.district ?? 'ALL'})</div></div>
          </section>
          <div className="panel">
            <h3 style={{ marginTop: 0 }}>Integration readiness by entity</h3>
            <table className="tbl">
              <thead><tr><th>Entity</th><th>Total</th><th>Mapped</th><th>Mapped %</th><th>Valid</th><th>Valid %</th><th>GIS covered</th><th>GIS %</th></tr></thead>
              <tbody>
                {(readiness?.rows ?? []).map((r) => (
                  <tr key={r.entityType}>
                    <td>{r.label}</td>
                    <td className="tnum">{r.total}</td>
                    <td className="tnum">{r.mapped}</td>
                    <td className="tnum" style={{ color: pctColor(r.mappedPct) }}>{r.mappedPct}%</td>
                    <td className="tnum">{r.valid}</td>
                    <td className="tnum" style={{ color: pctColor(r.validPct) }}>{r.validPct}%</td>
                    <td className="tnum">{r.gisCovered ?? '—'}</td>
                    <td className="tnum" style={{ color: r.gisPct != null ? pctColor(r.gisPct) : undefined }}>{r.gisPct != null ? `${r.gisPct}%` : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!readiness && <p className="muted">Loading…</p>}
          </div>
        </>
      )}

      {reportType === 'sync-activity' && (
        <>
          <section className="kpi-grid" style={{ marginBottom: 14 }}>
            <div className="kpi"><div className="val tnum">{syncActivity ? syncActivity.totalJobs : '—'}</div><div className="lbl">Sync jobs</div></div>
            <div className="kpi"><div className="val tnum" style={{ color: 'var(--ok)' }}>{syncActivity ? syncActivity.totals.success : '—'}</div><div className="lbl">Records synced</div></div>
            <div className="kpi"><div className="val tnum" style={{ color: 'var(--alarm)' }}>{syncActivity ? syncActivity.totals.failed : '—'}</div><div className="lbl">Failed</div></div>
            <div className="kpi"><div className="val tnum" style={{ color: 'var(--watch)' }}>{syncActivity ? syncActivity.openConflicts : '—'}</div><div className="lbl">Open conflicts</div></div>
          </section>
          <div className="panel">
            <h3 style={{ marginTop: 0 }}>Sync activity</h3>
            <div className="cc-legend row" style={{ fontSize: 13, flexWrap: 'wrap', gap: 16 }}>
              {syncActivity && Object.entries(syncActivity.byDirection).map(([k, v]) => <div key={k}><strong>{v}</strong> {k}</div>)}
              {syncActivity && Object.entries(syncActivity.byState).map(([k, v]) => <div key={k}><span className="dot" style={{ background: k === 'SUCCESS' ? 'var(--ok)' : k === 'PARTIAL' ? 'var(--watch)' : 'var(--alarm)' }} />{k}: <strong>{v}</strong></div>)}
            </div>
            <p className="muted" style={{ marginTop: 12, marginBottom: 0, fontSize: 12 }}>
              Last push: {syncActivity?.lastPush ? `${syncActivity.lastPush.entityType} · ${syncActivity.lastPush.state} · ${fmtDate(syncActivity.lastPush.at)}` : 'none'}<br />
              Last pull: {syncActivity?.lastPull ? `${syncActivity.lastPull.entityType} · ${syncActivity.lastPull.state} · ${fmtDate(syncActivity.lastPull.at)}` : 'none'}
            </p>
          </div>
        </>
      )}

      {reportType === 'jjm-migration' && (
        <>
          <section className="kpi-grid" style={{ marginBottom: 14 }}>
            <div className="kpi"><div className="val tnum">{jjm ? jjm.totals.batches : '—'}</div><div className="lbl">Import batches</div></div>
            <div className="kpi"><div className="val tnum" style={{ color: 'var(--ok)' }}>{jjm ? jjm.totals.created : '—'}</div><div className="lbl">Created</div></div>
            <div className="kpi"><div className="val tnum">{jjm ? jjm.totals.linked : '—'}</div><div className="lbl">Linked</div></div>
            <div className="kpi"><div className="val tnum muted">{jjm ? jjm.totals.skipped : '—'}</div><div className="lbl">Skipped</div></div>
          </section>
          <div className="panel">
            <h3 style={{ marginTop: 0 }}>JJM 1.0 migration batches</h3>
            <table className="tbl">
              <thead><tr><th>Batch</th><th>State</th><th>Total</th><th>Created</th><th>Linked</th><th>Skipped</th><th>When</th></tr></thead>
              <tbody>
                {(jjm?.batches ?? []).map((b) => (
                  <tr key={b.id}>
                    <td>{b.batchLabel}</td>
                    <td><span className={`pill ${b.state === 'SUCCESS' ? 'ok' : 'watch'}`}>{b.state}</span></td>
                    <td className="tnum">{b.total}</td>
                    <td className="tnum" style={{ color: 'var(--ok)' }}>{b.created}</td>
                    <td className="tnum">{b.linked}</td>
                    <td className="tnum muted">{b.skipped}</td>
                    <td className="muted" style={{ fontSize: 12 }}>{fmtDate(b.startedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {(!jjm || jjm.batches.length === 0) && <p className="muted">No legacy imports yet.</p>}
          </div>
        </>
      )}

      {reportType === 'access-matrix' && (
        <div className="panel">
          <h3 style={{ marginTop: 0 }}>Access matrix <span className="muted" style={{ fontSize: 13, fontWeight: 400 }}>· SWATI role → government role &amp; integration capabilities</span></h3>
          <table className="tbl">
            <thead><tr><th>SWATI role</th><th>Government role</th><th>Push</th><th>Pull</th><th>Resolve</th><th>Import</th><th>Geo-scope</th></tr></thead>
            <tbody>
              {roleMappings.map((r) => (
                <tr key={r.swatiRole}>
                  <td>{r.swatiRole}</td>
                  <td className="muted">{r.externalRole}</td>
                  <td>{yn(r.canPush)}</td>
                  <td>{yn(r.canPull)}</td>
                  <td>{yn(r.canResolve)}</td>
                  <td>{yn(r.canImport)}</td>
                  <td><span className="pill">{r.geoScope}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
          {roleMappings.length === 0 && <p className="muted">No role mappings configured.</p>}
          <div style={{ marginTop: 14 }}>
            <div className="ccp-h" style={{ marginBottom: 8 }}>Official Sujalam Bharat user types</div>
            <div className="cc-legend row" style={{ fontSize: 12, flexWrap: 'wrap', gap: 8 }}>
              {OFFICIAL_USER_TYPES.map((t) => <span key={t} className="pill" style={{ background: 'transparent', border: '1px solid var(--line)', color: 'var(--ink)' }}>{t}</span>)}
            </div>
            <p className="muted" style={{ marginTop: 8, marginBottom: 0, fontSize: 12 }}>Reference from the public Sujalam Bharat app. SWATI roles above map onto these government roles.</p>
          </div>
        </div>
      )}
    </>
  );
}

// --- interactive Leaflet map (dark): asset points + GeoJSON boundaries -------
function SujalamMap({ gis, height, visibleCats, search }: { gis: SujalamGis | null; height: number; visibleCats: Set<string>; search: string }) {
  const elRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const layerRef = useRef<L.LayerGroup | null>(null);

  useEffect(() => {
    if (mapRef.current || !elRef.current) return;
    const map = L.map(elRef.current, { center: [23.4, 88.4], zoom: 8, attributionControl: false });
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(map);
    layerRef.current = L.layerGroup().addTo(map);
    mapRef.current = map;
    setTimeout(() => map.invalidateSize(), 120);
    return () => { map.remove(); mapRef.current = null; };
  }, []);

  useEffect(() => {
    const map = mapRef.current, layer = layerRef.current;
    if (!map || !layer || !gis) return;
    layer.clearLayers();
    const q = search.trim().toLowerCase();
    const pts: [number, number][] = [];
    for (const b of gis.boundaries) {
      const color = b.kind === 'SERVICE_AREA' ? '#22d3ee' : '#f5d020';
      try {
        const gj = L.geoJSON(b.geojson as any, { style: { color, weight: 1.5, fillColor: color, fillOpacity: 0.12 } });
        gj.bindPopup(`${b.label} · ${b.kind === 'SERVICE_AREA' ? 'Service area' : 'Village'}`);
        gj.addTo(layer);
        gj.eachLayer((l: any) => { try { (l.getLatLngs()[0] as any[]).forEach((p: any) => pts.push([p.lat, p.lng])); } catch { /* ignore */ } });
      } catch { /* skip malformed geometry */ }
    }
    for (const p of gis.points) {
      if (!visibleCats.has(p.category)) continue;
      if (q && !(`${p.label} ${p.category}`.toLowerCase().includes(q))) continue;
      pts.push([p.lat, p.lng]);
      const cm = L.circleMarker([p.lat, p.lng], { radius: 4, color: '#fff', weight: 1, fillColor: p.mapped ? '#25c26e' : '#8a8f98', fillOpacity: 0.9 });
      cm.bindPopup(`${p.label} · ${p.category}${p.mapped ? ' · mapped' : ' · unmapped'}`);
      cm.addTo(layer);
    }
    if (pts.length) map.fitBounds(L.latLngBounds(pts).pad(0.2));
  }, [gis, visibleCats, search]);

  return <div ref={elRef} className="cc-leaflet" style={{ height }} />;
}

function GisTab({ gis }: { gis: SujalamGis | null }) {
  const c = gis?.counts;
  const categories = gis ? Object.keys(gis.byCategory).sort() : [];
  const [visibleCats, setVisibleCats] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState('');
  const [panelOpen, setPanelOpen] = useState(true);
  // Default: all categories visible once the data (and its category set) arrives.
  useEffect(() => { if (categories.length) setVisibleCats(new Set(categories)); }, [gis]);

  const toggle = (cat: string) => setVisibleCats((prev) => {
    const next = new Set(prev);
    if (next.has(cat)) next.delete(cat); else next.add(cat);
    return next;
  });
  const allOn = categories.length > 0 && categories.every((c2) => visibleCats.has(c2));

  return (
    <>
      <section className="kpi-grid" style={{ marginBottom: 14 }}>
        <div className="kpi"><div className="val tnum">{c ? `${c.assetsGeolocated}/${c.assets}` : '—'}</div><div className="lbl">Assets geolocated</div></div>
        <div className="kpi"><div className="val tnum">{c ? c.assets : '—'}</div><div className="lbl">Asset categories: {categories.length || '—'}</div></div>
        <div className="kpi"><div className="val tnum">{c ? `${c.serviceAreasWithBoundary}/${c.serviceAreas}` : '—'}</div><div className="lbl">Service-area boundaries</div></div>
        <div className="kpi"><div className="val tnum">{c ? `${c.villagesWithBoundary}/${c.villages}` : '—'}</div><div className="lbl">Village boundaries</div></div>
      </section>
      <div className="panel">
        <h3 style={{ marginTop: 0 }}>GIS map <span className="muted" style={{ fontSize: 13, fontWeight: 400 }}>· geolocated assets + service-area / village boundaries</span></h3>
        <div className="cc-legend row" style={{ fontSize: 12, marginBottom: 10, gap: 16, flexWrap: 'wrap' }}>
          <div><span className="dot" style={{ background: '#25c26e' }} /> Asset (mapped)</div>
          <div><span className="dot" style={{ background: '#8a8f98' }} /> Asset (unmapped)</div>
          <div><span className="dot" style={{ background: '#22d3ee' }} /> Service area</div>
          <div><span className="dot" style={{ background: '#f5d020' }} /> Village</div>
        </div>
        {/* Map + top-left asset filter/search overlay (mirrors the Sujalam Bharat "View All Assets" panel). */}
        <div style={{ position: 'relative' }}>
          <SujalamMap gis={gis} height={480} visibleCats={visibleCats} search={search} />
          <div style={{ position: 'absolute', top: 10, left: 10, zIndex: 1000, width: panelOpen ? 250 : 'auto', background: 'var(--surface, #10141c)', border: '1px solid var(--line, #2a2a3a)', borderRadius: 8, boxShadow: '0 2px 10px rgba(0,0,0,.35)', overflow: 'hidden' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 8px', gap: 8, borderBottom: panelOpen ? '1px solid var(--line, #2a2a3a)' : 'none' }}>
              <strong style={{ fontSize: 12 }}>{panelOpen ? 'Assets' : ''}</strong>
              <button className="pill" style={{ cursor: 'pointer', border: '1px solid var(--line)', background: 'transparent', color: 'var(--ink)', padding: '2px 8px' }} onClick={() => setPanelOpen((o) => !o)} title={panelOpen ? 'Collapse' : 'Expand'}>{panelOpen ? '‹' : '›'}</button>
            </div>
            {panelOpen && (
              <div style={{ padding: 8, maxHeight: 320, overflowY: 'auto' }}>
                <input className="input" style={{ width: '100%', boxSizing: 'border-box', marginBottom: 8, padding: '6px 8px', fontSize: 12 }} placeholder="Search assets…" value={search} onChange={(e) => setSearch(e.target.value)} />
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, marginBottom: 6, cursor: 'pointer' }}>
                  <input type="checkbox" checked={allOn} onChange={() => setVisibleCats(allOn ? new Set() : new Set(categories))} /> <strong>All asset types</strong>
                </label>
                {categories.map((cat) => (
                  <label key={cat} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, marginBottom: 4, cursor: 'pointer' }}>
                    <input type="checkbox" checked={visibleCats.has(cat)} onChange={() => toggle(cat)} />
                    <span style={{ flex: 1 }}>{cat}</span>
                    <span className="muted">{gis?.byCategory[cat]}</span>
                  </label>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}

function OverviewTab({ ov }: { ov: SujalamOverview | null }) {
  return (
    <>
      <section className="kpi-grid" style={{ marginBottom: 14 }}>
        <div className="kpi">
          <div className="val tnum" style={{ color: ov ? readinessColor(ov.readinessPct) : undefined }}>{ov ? `${ov.readinessPct}%` : '—'}</div>
          <div className="lbl">Mapping readiness</div>
        </div>
        <div className="kpi"><div className="val tnum">{ov ? ov.schemes.total : '—'}</div><div className="lbl">Schemes ({ov ? ov.schemes.mapped : 0} mapped)</div></div>
        <div className="kpi"><div className="val tnum">{ov ? ov.serviceAreas.total : '—'}</div><div className="lbl">Service areas</div></div>
        <div className="kpi"><div className="val tnum">{ov ? ov.sujalGaon.total : '—'}</div><div className="lbl">Sujal Gaon villages ({ov ? ov.sujalGaon.mapped : 0} mapped)</div></div>
        <div className="kpi"><div className="val tnum">{ov ? ov.infrastructure.total : '—'}</div><div className="lbl">Infrastructure assets ({ov ? ov.infrastructure.mapped : 0} mapped)</div></div>
      </section>

      <div className="panel" style={{ marginBottom: 12 }}>
        <h3 style={{ marginTop: 0 }}>Integration providers</h3>
        <table className="tbl">
          <thead><tr><th>System</th><th>Name</th><th>Status</th><th>Mode</th><th>Push</th><th>Pull</th></tr></thead>
          <tbody>
            {(ov?.providers ?? []).map((p, i) => (
              <tr key={i}>
                <td>{SYS_LABEL[p.system] ?? p.system}</td>
                <td className="muted">{p.name}</td>
                <td><span className={`pill ${p.enabled ? 'ok' : 'watch'}`}>{p.enabled ? 'ENABLED' : 'DISABLED'}</span></td>
                <td>{p.mockMode ? <span className="pill watch">MOCK</span> : <span className="pill ok">LIVE</span>}</td>
                <td>{p.supportsPush ? '✓' : '—'}</td>
                <td>{p.supportsPull ? '✓' : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {(!ov || ov.providers.length === 0) && <p className="muted">No integration providers configured.</p>}
      </div>

      <div className="panel">
        <h3 style={{ marginTop: 0 }}>Scheme mapping status</h3>
        <div className="cc-legend row" style={{ fontSize: 13, flexWrap: 'wrap', gap: 16 }}>
          {ov && Object.keys(ov.status).length > 0 ? (
            Object.entries(ov.status).map(([k, v]) => (
              <div key={k}><span className="dot" style={{ background: STATUS_COLOR[k] ?? 'var(--muted)' }} /> {k}: <strong>{v}</strong></div>
            ))
          ) : <span className="muted">No mapping records yet.</span>}
        </div>
        <p className="muted" style={{ marginTop: 12, marginBottom: 0, fontSize: 12 }}>
          Last sync: {ov?.lastSync ? `${SYS_LABEL[ov.lastSync.provider] ?? ov.lastSync.provider} · ${ov.lastSync.direction} · ${ov.lastSync.state}` : 'none yet'}
        </p>
      </div>
    </>
  );
}

function MappingTab({ mappings, preview, classification, authed }: { mappings: FieldMappingRow[]; preview: MapPreview | null; classification: ClassificationSummary | null; authed: boolean }) {
  return (
    <>
      <div className="panel" style={{ marginBottom: 12 }}>
        <h3 style={{ marginTop: 0 }}>Field mapping <span className="muted" style={{ fontSize: 13, fontWeight: 400 }}>· SWATI field → external field</span></h3>
        <table className="tbl">
          <thead><tr><th>Internal field</th><th>Class</th><th></th><th>External field</th><th>Transform</th><th>Required</th></tr></thead>
          <tbody>
            {mappings.map((m) => {
              const cls = classify(m.internalField, classification);
              return (
              <tr key={m.id}>
                <td className="tnum">{m.internalField}</td>
                <td>{cls === 'PUBLIC' ? <span className="muted" style={{ fontSize: 11 }}>public</span> : <span className={`pill ${CLASS_PILL[cls]}`} style={{ fontSize: 10 }}>{cls}</span>}</td>
                <td className="muted">→</td>
                <td className="tnum">{m.externalField}</td>
                <td>
                  <span className="pill">{m.transform}</span>
                  {m.transformArg && <span className="muted" style={{ fontSize: 11, marginLeft: 6 }}>{m.transformArg}</span>}
                </td>
                <td>{m.required ? <span className="pill watch">required</span> : <span className="muted">optional</span>}</td>
              </tr>
              );
            })}
          </tbody>
        </table>
        {mappings.length === 0 && <p className="muted">No field mappings configured for this provider + entity type.</p>}
        {classification && (
          <p className="muted" style={{ marginTop: 8, marginBottom: 0, fontSize: 12 }}>
            <span className="pill alarm" style={{ fontSize: 10 }}>SENSITIVE</span> household-level and <span className="pill watch" style={{ fontSize: 10 }}>INTERNAL</span> demographic fields are redacted from public responses. {classification.note}
          </p>
        )}
      </div>

      <div className="panel">
        <h3 style={{ marginTop: 0 }}>
          Payload preview
          {preview?.entity && <span className="muted" style={{ fontSize: 13, fontWeight: 400 }}> · {preview.entity.label}</span>}
        </h3>
        {!authed && preview?.redactedFields && preview.redactedFields.length > 0 && (
          <div className="cc-legend row" style={{ fontSize: 12, marginBottom: 10 }}>
            <span style={{ color: 'var(--watch)' }}>Redacted for public view: {preview.redactedFields.join(', ')} — sign in to reveal.</span>
          </div>
        )}
        {preview?.missingRequired && preview.missingRequired.length > 0 && (
          <div className="cc-legend row" style={{ fontSize: 12, marginBottom: 10 }}>
            <span style={{ color: 'var(--alarm)' }}>Missing required: {preview.missingRequired.join(', ')}</span>
          </div>
        )}
        {preview?.entity ? (
          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
            <div style={{ flex: 1, minWidth: 260 }}>
              <div className="ccp-h" style={{ marginBottom: 8 }}>Internal (SWATI)</div>
              <table className="tbl">
                <tbody>
                  {Object.entries(preview.internal).map(([k, v]) => (
                    <tr key={k}><td className="muted tnum">{k}</td><td className="tnum">{fmtVal(v)}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div style={{ flex: 1, minWidth: 260 }}>
              <div className="ccp-h" style={{ marginBottom: 8 }}>External payload (mock)</div>
              <table className="tbl">
                <tbody>
                  {Object.entries(preview.external).map(([k, v]) => (
                    <tr key={k}><td className="muted tnum">{k}</td><td className="tnum">{fmtVal(v)}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : <p className="muted">No entity available to preview.</p>}
      </div>
    </>
  );
}

function ValidationTab({ rules, report }: { rules: ValidationRuleRow[]; report: ValidationReport | null }) {
  const s = report?.summary;
  return (
    <>
      <section className="kpi-grid" style={{ marginBottom: 14 }}>
        <div className="kpi"><div className="val tnum">{s ? s.total : '—'}</div><div className="lbl">Entities checked</div></div>
        <div className="kpi"><div className="val tnum" style={{ color: 'var(--ok)' }}>{s ? s.valid : '—'}</div><div className="lbl">Valid (ready for sync)</div></div>
        <div className="kpi"><div className="val tnum" style={{ color: 'var(--alarm)' }}>{s ? s.invalid : '—'}</div><div className="lbl">Invalid (has errors)</div></div>
        <div className="kpi"><div className="val tnum" style={{ color: 'var(--watch)' }}>{s ? s.withWarnings : '—'}</div><div className="lbl">With warnings</div></div>
        <div className="kpi"><div className="val tnum">{report ? report.ruleCount : '—'}</div><div className="lbl">Rules applied</div></div>
      </section>

      <div className="panel" style={{ marginBottom: 12 }}>
        <h3 style={{ marginTop: 0 }}>Validation issues <span className="muted" style={{ fontSize: 13, fontWeight: 400 }}>· entities with errors or warnings</span></h3>
        <table className="tbl">
          <thead><tr><th>Entity</th><th>Status</th><th>Errors</th><th>Warnings</th><th>Details</th></tr></thead>
          <tbody>
            {(report?.issues ?? []).map((r) => (
              <tr key={r.id}>
                <td>{r.label}</td>
                <td><span className={`pill ${r.valid ? 'watch' : 'alarm'}`}>{r.valid ? 'WARN' : 'INVALID'}</span></td>
                <td className="tnum" style={{ color: r.errors ? 'var(--alarm)' : undefined }}>{r.errors}</td>
                <td className="tnum" style={{ color: r.warnings ? 'var(--watch)' : undefined }}>{r.warnings}</td>
                <td className="muted" style={{ fontSize: 12 }}>{r.details.map((d) => d.message).join(' · ')}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {report && report.issues.length === 0 && <p className="muted">All checked entities pass with no warnings.</p>}
      </div>

      <div className="panel">
        <h3 style={{ marginTop: 0 }}>Rules</h3>
        <table className="tbl">
          <thead><tr><th>Field</th><th>Rule</th><th>Param</th><th>Severity</th><th>Scope</th><th>Message</th></tr></thead>
          <tbody>
            {rules.map((r) => (
              <tr key={r.id}>
                <td className="tnum">{r.field}</td>
                <td><span className="pill">{r.ruleType}</span></td>
                <td className="muted tnum">{r.param ?? '—'}</td>
                <td><span className={`pill ${r.severity === 'ERROR' ? 'alarm' : 'watch'}`}>{r.severity}</span></td>
                <td className="muted">{r.externalSystem ? (SYS_LABEL[r.externalSystem] ?? r.externalSystem) : 'All providers'}</td>
                <td className="muted" style={{ fontSize: 12 }}>{r.message}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {rules.length === 0 && <p className="muted">No validation rules configured for this entity type.</p>}
      </div>
    </>
  );
}
