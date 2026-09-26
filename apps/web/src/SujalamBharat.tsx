import { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import {
  SujalamOverview, FieldMappingRow, ValidationRuleRow, MapPreview, ValidationReport, SujalamGis,
  SyncJobs, ConflictRow, SyncResult, ImportResult, api,
} from './api';
import { useAuth } from './contexts';

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

type Tab = 'overview' | 'mapping' | 'validation' | 'gis' | 'sync';

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

  useEffect(() => {
    api.sujalamOverview().then(setOv).catch(() => setErr('Could not load Sujalam Bharat integration data.'));
  }, []);

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
      {tab === 'mapping' && <MappingTab mappings={mappings} preview={preview} />}
      {tab === 'validation' && <ValidationTab rules={rules} report={report} />}
      {tab === 'gis' && <GisTab gis={gis} />}
      {tab === 'sync' && (
        <SyncTab
          jobs={jobs} conflicts={conflicts} busy={busy} actionMsg={actionMsg} canAct={!!user}
          onPush={() => runAction('Push', () => api.sujalamPush(system, entityType))}
          onPull={() => runAction('Pull', () => api.sujalamPull(system, entityType))}
          onImport={() => runAction('JJM import', () => api.sujalamImportJjm())}
          onResolve={resolve}
        />
      )}
    </div>
  );
}

function SyncTab({ jobs, conflicts, busy, actionMsg, canAct, onPush, onPull, onImport, onResolve }: {
  jobs: SyncJobs | null; conflicts: ConflictRow[]; busy: boolean; actionMsg: string; canAct: boolean;
  onPush: () => void; onPull: () => void; onImport: () => void;
  onResolve: (id: string, resolution: 'INTERNAL' | 'EXTERNAL') => void;
}) {
  const fmtDate = (s: string | null) => (s ? new Date(s).toLocaleString() : '—');
  const stateColor = (s: string) => (s === 'SUCCESS' ? 'ok' : s === 'PARTIAL' ? 'watch' : s === 'FAILED' ? 'alarm' : 'watch');
  return (
    <>
      <div className="panel" style={{ marginBottom: 12 }}>
        <h3 style={{ marginTop: 0 }}>Run sync <span className="muted" style={{ fontSize: 13, fontWeight: 400 }}>· mock bidirectional sync + legacy import</span></h3>
        {!canAct && <div className="cc-legend row" style={{ fontSize: 12, marginBottom: 10 }}><span style={{ color: 'var(--watch)' }}>Sign in to run sync actions (public users can view history and conflicts).</span></div>}
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <button className="pill ok" style={{ cursor: 'pointer', padding: '8px 16px', opacity: canAct && !busy ? 1 : 0.5 }} disabled={!canAct || busy} onClick={onPush}>Push to provider →</button>
          <button className="pill" style={{ cursor: 'pointer', padding: '8px 16px', border: '1px solid var(--line)', opacity: canAct && !busy ? 1 : 0.5 }} disabled={!canAct || busy} onClick={onPull}>← Pull from provider</button>
          <button className="pill" style={{ cursor: 'pointer', padding: '8px 16px', border: '1px solid var(--line)', opacity: canAct && !busy ? 1 : 0.5 }} disabled={!canAct || busy} onClick={onImport}>Import from JJM 1.0</button>
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
                  <button className="pill" style={{ cursor: canAct && !busy ? 'pointer' : 'default', border: '1px solid var(--line)', opacity: canAct && !busy ? 1 : 0.5 }} disabled={!canAct || busy} onClick={() => onResolve(c.id, 'INTERNAL')}>Keep SWATI</button>
                  <button className="pill watch" style={{ cursor: canAct && !busy ? 'pointer' : 'default', opacity: canAct && !busy ? 1 : 0.5 }} disabled={!canAct || busy} onClick={() => onResolve(c.id, 'EXTERNAL')}>Take provider</button>
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

// --- interactive Leaflet map (dark): asset points + GeoJSON boundaries -------
function SujalamMap({ gis, height }: { gis: SujalamGis | null; height: number }) {
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
      pts.push([p.lat, p.lng]);
      const cm = L.circleMarker([p.lat, p.lng], { radius: 4, color: '#fff', weight: 1, fillColor: p.mapped ? '#25c26e' : '#8a8f98', fillOpacity: 0.9 });
      cm.bindPopup(`${p.label}${p.mapped ? ' · mapped' : ' · unmapped'}`);
      cm.addTo(layer);
    }
    if (pts.length) map.fitBounds(L.latLngBounds(pts).pad(0.2));
  }, [gis]);

  return <div ref={elRef} className="cc-leaflet" style={{ height }} />;
}

function GisTab({ gis }: { gis: SujalamGis | null }) {
  const c = gis?.counts;
  return (
    <>
      <section className="kpi-grid" style={{ marginBottom: 14 }}>
        <div className="kpi"><div className="val tnum">{c ? `${c.assetsGeolocated}/${c.assets}` : '—'}</div><div className="lbl">Assets geolocated</div></div>
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
        <SujalamMap gis={gis} height={460} />
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

function MappingTab({ mappings, preview }: { mappings: FieldMappingRow[]; preview: MapPreview | null }) {
  return (
    <>
      <div className="panel" style={{ marginBottom: 12 }}>
        <h3 style={{ marginTop: 0 }}>Field mapping <span className="muted" style={{ fontSize: 13, fontWeight: 400 }}>· SWATI field → external field</span></h3>
        <table className="tbl">
          <thead><tr><th>Internal field</th><th></th><th>External field</th><th>Transform</th><th>Required</th></tr></thead>
          <tbody>
            {mappings.map((m) => (
              <tr key={m.id}>
                <td className="tnum">{m.internalField}</td>
                <td className="muted">→</td>
                <td className="tnum">{m.externalField}</td>
                <td>
                  <span className="pill">{m.transform}</span>
                  {m.transformArg && <span className="muted" style={{ fontSize: 11, marginLeft: 6 }}>{m.transformArg}</span>}
                </td>
                <td>{m.required ? <span className="pill watch">required</span> : <span className="muted">optional</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {mappings.length === 0 && <p className="muted">No field mappings configured for this provider + entity type.</p>}
      </div>

      <div className="panel">
        <h3 style={{ marginTop: 0 }}>
          Payload preview
          {preview?.entity && <span className="muted" style={{ fontSize: 13, fontWeight: 400 }}> · {preview.entity.label}</span>}
        </h3>
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
