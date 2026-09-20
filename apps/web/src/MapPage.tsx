import { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import * as XLSX from 'xlsx';
import { GisImportRow, MapPoint, api } from './api';
import { useAuth } from './contexts';

const STATUS_COLOR: Record<string, string> = {
  RUNNING: '#2ea36b', FAULT: '#e0533d', STOPPED: '#d0a215',
};
function colorFor(status: string) { return STATUS_COLOR[status] ?? '#2f81f7'; }

// --- file parsing (xls/csv via SheetJS, kml via DOMParser) -----------------
function pick(row: Record<string, any>, keys: string[]): any {
  const lower: Record<string, any> = {};
  for (const k of Object.keys(row)) lower[k.toLowerCase().trim()] = row[k];
  for (const k of keys) if (lower[k] != null && lower[k] !== '') return lower[k];
  return undefined;
}

function rowsFromSheet(rows: Record<string, any>[]): GisImportRow[] {
  const out: GisImportRow[] = [];
  rows.forEach((r, i) => {
    const lat = Number(pick(r, ['latitude', 'lat', 'y']));
    const lng = Number(pick(r, ['longitude', 'lng', 'lon', 'long', 'x']));
    if (Number.isNaN(lat) || Number.isNaN(lng)) return;
    const name = String(pick(r, ['name', 'label', 'asset']) ?? `Point ${i + 1}`);
    const tag = String(pick(r, ['tag', 'id', 'code']) ?? name).slice(0, 40);
    const type = pick(r, ['type', 'category']);
    out.push({ tag, name, type: type ? String(type).toUpperCase() : undefined, latitude: lat, longitude: lng });
  });
  return out;
}

function rowsFromKml(text: string): GisImportRow[] {
  const doc = new DOMParser().parseFromString(text, 'text/xml');
  const marks = Array.from(doc.getElementsByTagName('Placemark'));
  const out: GisImportRow[] = [];
  marks.forEach((m, i) => {
    const coord = m.getElementsByTagName('coordinates')[0]?.textContent?.trim();
    if (!coord) return;
    const [lng, lat] = coord.split(/\s+/)[0].split(',').map(Number);
    if (Number.isNaN(lat) || Number.isNaN(lng)) return;
    const name = m.getElementsByTagName('name')[0]?.textContent?.trim() || `Placemark ${i + 1}`;
    out.push({ tag: name.slice(0, 40), name, latitude: lat, longitude: lng });
  });
  return out;
}

async function parseFile(file: File): Promise<GisImportRow[]> {
  const ext = file.name.toLowerCase().split('.').pop();
  if (ext === 'kml') return rowsFromKml(await file.text());
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: 'array' });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  return rowsFromSheet(XLSX.utils.sheet_to_json(sheet, { defval: '' }));
}

export function MapPage() {
  const { user } = useAuth();
  const [points, setPoints] = useState<MapPoint[]>([]);
  const [err, setErr] = useState('');
  const [preview, setPreview] = useState<GisImportRow[] | null>(null);
  const [importMsg, setImportMsg] = useState('');
  const [busy, setBusy] = useState(false);

  const elRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const layerRef = useRef<L.LayerGroup | null>(null);

  const canImport = !!user?.permissions?.some((p) => p === 'gis.import' || p === '*');

  const load = () => api.mapPoints().then(setPoints).catch(() => setErr('Could not load map points.'));
  useEffect(() => { load(); }, []);

  // Init Leaflet once.
  useEffect(() => {
    if (mapRef.current || !elRef.current) return;
    const map = L.map(elRef.current, { center: [15.2, 74.11], zoom: 12, scrollWheelZoom: true });
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19, attribution: '&copy; OpenStreetMap contributors',
    }).addTo(map);
    layerRef.current = L.layerGroup().addTo(map);
    mapRef.current = map;
    setTimeout(() => map.invalidateSize(), 100);
    return () => { map.remove(); mapRef.current = null; };
  }, []);

  // Re-render markers when points change.
  useEffect(() => {
    const map = mapRef.current, layer = layerRef.current;
    if (!map || !layer) return;
    layer.clearLayers();
    const latlngs: [number, number][] = [];
    for (const p of points) {
      const lat = Number(p.latitude), lng = Number(p.longitude);
      latlngs.push([lat, lng]);
      L.circleMarker([lat, lng], {
        radius: 8, color: '#fff', weight: 1.5, fillColor: colorFor(p.status), fillOpacity: 0.9,
      })
        .bindPopup(`<strong>${p.tag}</strong> · ${p.name}<br>${p.type}${p.transport ? ` · ${p.transport}` : ''}${p.health != null ? ` · health ${p.health}` : ''}`)
        .addTo(layer);
    }
    if (latlngs.length) map.fitBounds(L.latLngBounds(latlngs).pad(0.2));
  }, [points]);

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    setErr(''); setImportMsg('');
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const rows = await parseFile(file);
      if (rows.length === 0) { setErr('No valid coordinates found in that file.'); setPreview(null); return; }
      setPreview(rows);
    } catch {
      setErr('Could not parse that file. Use CSV, XLS/XLSX, or KML.');
    } finally {
      e.target.value = '';
    }
  };

  const commitImport = async () => {
    if (!preview) return;
    setBusy(true); setErr('');
    try {
      const res = await api.gisImport(preview);
      setImportMsg(`Imported ${res.total}: ${res.created} new, ${res.updated} updated.`);
      setPreview(null);
      await load();
    } catch (e: any) {
      setErr(e?.response?.data?.message ?? 'Import failed.');
    } finally {
      setBusy(false);
    }
  };

  const counts = points.reduce((a, p) => { a[p.status] = (a[p.status] ?? 0) + 1; return a; }, {} as Record<string, number>);

  return (
    <div>
      <div className="exec-head">
        <div>
          <h1 className="exec-title" style={{ fontSize: 26 }}>INTERACTIVE MAP</h1>
          <p className="exec-sub">{points.length} located assets & devices</p>
        </div>
        <div className="statuspills">
          <span className="pill ok">{counts.RUNNING ?? 0} running</span>
          <span className="pill alarm">{counts.FAULT ?? 0} fault</span>
          <span className="pill watch">{counts.STOPPED ?? 0} stopped</span>
        </div>
      </div>

      {err && <div className="err">{err}</div>}

      <div ref={elRef} className="leafmap" />

      {canImport && (
        <div className="panel" style={{ marginTop: 16 }}>
          <h3 style={{ marginTop: 0 }}>Import assets (GIS)</h3>
          <p className="muted">Upload a CSV, XLS/XLSX or KML with coordinate columns (tag, name, type, latitude, longitude). Rows upsert onto the map by tag.</p>
          <input type="file" accept=".csv,.xls,.xlsx,.kml" onChange={onFile} />
          {importMsg && <div className="flash" style={{ marginTop: 12 }}><span>{importMsg}</span></div>}
          {preview && (
            <div style={{ marginTop: 12 }}>
              <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 8 }}>
                <strong>{preview.length} rows parsed</strong>
                <button className="btn sm" disabled={busy} onClick={commitImport}>{busy ? 'Importing…' : `Import ${preview.length} assets`}</button>
                <button className="btn ghost sm" onClick={() => setPreview(null)}>Cancel</button>
              </div>
              <table className="tbl">
                <thead><tr><th>Tag</th><th>Name</th><th>Type</th><th>Lat</th><th>Lng</th></tr></thead>
                <tbody>
                  {preview.slice(0, 8).map((r, i) => (
                    <tr key={i}><td>{r.tag}</td><td>{r.name}</td><td className="muted">{r.type ?? 'DMA'}</td><td className="tnum">{r.latitude.toFixed(4)}</td><td className="tnum">{r.longitude.toFixed(4)}</td></tr>
                  ))}
                </tbody>
              </table>
              {preview.length > 8 && <p className="muted">…and {preview.length - 8} more.</p>}
            </div>
          )}
        </div>
      )}

      <div className="panel" style={{ marginTop: 16 }}>
        <table className="tbl">
          <thead><tr><th>Tag</th><th>Name</th><th>Type</th><th>Status</th><th>Transport</th><th>Health</th><th>Lat</th><th>Lng</th></tr></thead>
          <tbody>
            {points.map((p) => (
              <tr key={p.id}>
                <td>{p.tag}</td>
                <td>{p.name}</td>
                <td className="muted">{p.type}</td>
                <td><span className={`pill ${p.status === 'RUNNING' ? 'ok' : p.status === 'FAULT' ? 'alarm' : 'watch'}`}>{p.status}</span></td>
                <td className="muted">{p.transport ?? '—'}</td>
                <td className="tnum">{p.health ?? '—'}</td>
                <td className="tnum muted">{Number(p.latitude).toFixed(4)}</td>
                <td className="tnum muted">{Number(p.longitude).toFixed(4)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
