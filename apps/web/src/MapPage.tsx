import { useEffect, useMemo, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import * as XLSX from 'xlsx';
import { GisImportRow, MapAsset, MapData, MapSite, api } from './api';
import { useAuth } from './contexts';

const STATUS_COLOR: Record<string, string> = {
  RUNNING: '#2ea36b', FAULT: '#e0533d', STOPPED: '#d0a215',
};
function assetColor(status: string) { return STATUS_COLOR[status] ?? '#2f81f7'; }
function siteColor(s: MapSite) {
  if (s.fault > 0) return '#e0533d';                       // any faulted pump
  return s.phType === 'Intermediate' ? '#2f81f7' : '#22b8a6'; // Intermediate vs Basic
}
const ALL = '';

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

function uniqSorted(vals: (string | null)[]): string[] {
  return Array.from(new Set(vals.filter((v): v is string => !!v))).sort();
}

export function MapPage() {
  const { user } = useAuth();
  const [data, setData] = useState<MapData>({ sites: [], assets: [] });
  const [err, setErr] = useState('');
  const [preview, setPreview] = useState<GisImportRow[] | null>(null);
  const [importMsg, setImportMsg] = useState('');
  const [busy, setBusy] = useState(false);

  // Filters
  const [district, setDistrict] = useState(ALL);
  const [block, setBlock] = useState(ALL);
  const [zone, setZone] = useState(ALL);
  const [search, setSearch] = useState('');
  const [showAssets, setShowAssets] = useState(false);

  const elRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const siteLayerRef = useRef<L.LayerGroup | null>(null);
  const assetLayerRef = useRef<L.LayerGroup | null>(null);
  const didFit = useRef(false);

  const canImport = !!user?.permissions?.some((p) => p === 'gis.import' || p === '*');

  const load = () => api.mapPoints().then(setData).catch(() => setErr('Could not load map data.'));
  useEffect(() => { load(); }, []);

  // Cascading filter option lists.
  const districts = useMemo(() => uniqSorted(data.sites.map((s) => s.district)), [data.sites]);
  const blocks = useMemo(
    () => uniqSorted(data.sites.filter((s) => !district || s.district === district).map((s) => s.block)),
    [data.sites, district],
  );
  const zones = useMemo(
    () => uniqSorted(
      data.sites
        .filter((s) => (!district || s.district === district) && (!block || s.block === block))
        .map((s) => s.zone),
    ),
    [data.sites, district, block],
  );

  const matches = (d: string | null, b: string | null, z: string | null) =>
    (!district || d === district) && (!block || b === block) && (!zone || z === zone);

  const filteredSites = useMemo(() => {
    const q = search.trim().toLowerCase();
    return data.sites.filter((s) =>
      matches(s.district, s.block, s.zone) &&
      (!q || `${s.name} ${s.scheme ?? ''} ${s.code ?? ''}`.toLowerCase().includes(q)),
    );
  }, [data.sites, district, block, zone, search]);

  const filteredAssets = useMemo(
    () => data.assets.filter((a) => matches(a.district, a.block, a.zone)),
    [data.assets, district, block, zone],
  );

  // Init Leaflet once, centred on West Bengal.
  useEffect(() => {
    if (mapRef.current || !elRef.current) return;
    const map = L.map(elRef.current, { center: [23.5, 88.6], zoom: 9, scrollWheelZoom: true });
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19, attribution: '&copy; OpenStreetMap contributors',
    }).addTo(map);
    siteLayerRef.current = L.layerGroup().addTo(map);
    assetLayerRef.current = L.layerGroup().addTo(map);
    mapRef.current = map;
    setTimeout(() => map.invalidateSize(), 100);
    return () => { map.remove(); mapRef.current = null; };
  }, []);

  // Re-render markers when the filtered sets change.
  useEffect(() => {
    const map = mapRef.current, siteLayer = siteLayerRef.current, assetLayer = assetLayerRef.current;
    if (!map || !siteLayer || !assetLayer) return;
    siteLayer.clearLayers();
    assetLayer.clearLayers();
    const latlngs: [number, number][] = [];

    for (const s of filteredSites) {
      const lat = Number(s.latitude), lng = Number(s.longitude);
      latlngs.push([lat, lng]);
      L.circleMarker([lat, lng], {
        radius: 7, color: '#fff', weight: 1.5, fillColor: siteColor(s), fillOpacity: 0.9,
      })
        .bindPopup(
          `<strong>${s.name}</strong><br>` +
          `${s.phType ?? '—'} pump house<br>` +
          `${[s.district, s.block, s.zone].filter(Boolean).join(' · ')}<br>` +
          `${s.pumpCount} pump(s)${s.fault ? ` · <b style="color:#e0533d">${s.fault} fault</b>` : ''} · ${s.assetCount} assets<br>` +
          `<span style="opacity:.6">${lat.toFixed(5)}, ${lng.toFixed(5)}</span>`,
        )
        .addTo(siteLayer);
    }

    if (showAssets) {
      for (const a of filteredAssets) {
        const lat = Number(a.latitude), lng = Number(a.longitude);
        L.circleMarker([lat, lng], {
          radius: 3.5, color: assetColor(a.status), weight: 1, fillColor: assetColor(a.status), fillOpacity: 0.85,
        })
          .bindPopup(
            `<strong>${a.tag}</strong> · ${a.name}<br>${a.type}` +
            `${a.transport ? ` · ${a.transport}` : ''}${a.health != null ? ` · health ${a.health}` : ''}`,
          )
          .addTo(assetLayer);
      }
    }

    // Fit once on first data, and whenever a filter narrows the set.
    if (latlngs.length && (!didFit.current || district || block || zone || search)) {
      map.fitBounds(L.latLngBounds(latlngs).pad(0.2));
      didFit.current = true;
    }
  }, [filteredSites, filteredAssets, showAssets, district, block, zone, search]);

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

  const resetFilters = () => { setDistrict(ALL); setBlock(ALL); setZone(ALL); setSearch(''); };
  const intermediate = filteredSites.filter((s) => s.phType === 'Intermediate').length;
  const basic = filteredSites.filter((s) => s.phType === 'Basic').length;
  const faults = filteredSites.reduce((n, s) => n + (s.fault > 0 ? 1 : 0), 0);

  return (
    <div>
      <div className="exec-head">
        <div>
          <h1 className="exec-title" style={{ fontSize: 26 }}>INTERACTIVE MAP</h1>
          <p className="exec-sub">
            {filteredSites.length} of {data.sites.length} pump houses
            {showAssets ? ` · ${filteredAssets.length} assets shown` : ` · ${data.assets.length} assets (toggle to show)`}
          </p>
        </div>
        <div className="statuspills">
          <span className="pill ok">{intermediate} intermediate</span>
          <span className="pill watch">{basic} basic</span>
          <span className="pill alarm">{faults} with fault</span>
        </div>
      </div>

      {err && <div className="err">{err}</div>}

      {/* Filter bar */}
      <div className="panel" style={{ marginBottom: 12, display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center' }}>
        <select className="input" value={district} onChange={(e) => { setDistrict(e.target.value); setBlock(ALL); setZone(ALL); }}>
          <option value={ALL}>All districts</option>
          {districts.map((d) => <option key={d} value={d}>{d}</option>)}
        </select>
        <select className="input" value={block} onChange={(e) => { setBlock(e.target.value); setZone(ALL); }}>
          <option value={ALL}>All blocks</option>
          {blocks.map((b) => <option key={b} value={b}>{b}</option>)}
        </select>
        <select className="input" value={zone} onChange={(e) => setZone(e.target.value)}>
          <option value={ALL}>All zones</option>
          {zones.map((z) => <option key={z} value={z}>{z}</option>)}
        </select>
        <input className="input" placeholder="Search scheme / code…" value={search} onChange={(e) => setSearch(e.target.value)} style={{ minWidth: 180 }} />
        <label style={{ display: 'flex', gap: 6, alignItems: 'center', cursor: 'pointer' }}>
          <input type="checkbox" checked={showAssets} onChange={(e) => setShowAssets(e.target.checked)} />
          Show adjacent assets
        </label>
        {(district || block || zone || search) && (
          <button className="btn ghost sm" onClick={resetFilters}>Clear</button>
        )}
      </div>

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
          <thead><tr><th>Code</th><th>Scheme</th><th>Pump House</th><th>Type</th><th>District</th><th>Block</th><th>Zone</th><th>Pumps</th><th>Lat</th><th>Lng</th></tr></thead>
          <tbody>
            {filteredSites.slice(0, 200).map((s) => (
              <tr key={s.id}>
                <td className="muted">{s.code}</td>
                <td>{s.scheme}</td>
                <td>{s.name.split(' — ')[1] ?? ''}</td>
                <td><span className={`pill ${s.phType === 'Intermediate' ? 'ok' : 'watch'}`}>{s.phType ?? '—'}</span></td>
                <td className="muted">{s.district}</td>
                <td className="muted">{s.block}</td>
                <td className="muted">{s.zone ?? '—'}</td>
                <td className="tnum">{s.pumpCount}{s.fault ? ` (${s.fault}!)` : ''}</td>
                <td className="tnum muted">{Number(s.latitude).toFixed(4)}</td>
                <td className="tnum muted">{Number(s.longitude).toFixed(4)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {filteredSites.length > 200 && <p className="muted">Showing first 200 of {filteredSites.length}. Narrow the filters to see more.</p>}
      </div>
    </div>
  );
}
