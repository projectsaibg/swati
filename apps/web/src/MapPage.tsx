import { useEffect, useMemo, useState } from 'react';
import { MapPoint, api } from './api';

// Lightweight coordinate scatter over a normalized bounding box. This is the
// M3 base map; a real tiled basemap / Cesium 3D globe lands in a later
// milestone. It plots every asset/device by lat/lng, colored by status.
export function MapPage() {
  const [points, setPoints] = useState<MapPoint[]>([]);
  const [err, setErr] = useState('');
  const [hover, setHover] = useState<MapPoint | null>(null);

  useEffect(() => {
    api.mapPoints().then(setPoints).catch(() => setErr('Could not load map points.'));
  }, []);

  const box = useMemo(() => {
    if (points.length === 0) return null;
    const lats = points.map((p) => Number(p.latitude));
    const lngs = points.map((p) => Number(p.longitude));
    return { minLat: Math.min(...lats), maxLat: Math.max(...lats), minLng: Math.min(...lngs), maxLng: Math.max(...lngs) };
  }, [points]);

  const place = (p: MapPoint) => {
    if (!box) return { left: '50%', top: '50%' };
    const spanLat = box.maxLat - box.minLat || 1;
    const spanLng = box.maxLng - box.minLng || 1;
    const x = 6 + ((Number(p.longitude) - box.minLng) / spanLng) * 88; // 6%..94%
    const y = 6 + ((box.maxLat - Number(p.latitude)) / spanLat) * 88; // invert lat (north up)
    return { left: `${x}%`, top: `${y}%` };
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

      <div className="mapwrap" onMouseLeave={() => setHover(null)}>
        {points.map((p) => (
          <div
            key={p.id}
            className={`mappt ${p.status}`}
            style={place(p)}
            onMouseEnter={() => setHover(p)}
          />
        ))}
        {hover && (
          <div className="maptip" style={place(hover)}>
            <strong>{hover.tag}</strong> · {hover.name}<br />
            {hover.type}{hover.transport ? ` · ${hover.transport}` : ''}
            {hover.health != null ? ` · health ${hover.health}` : ''}
          </div>
        )}
        {points.length === 0 && !err && (
          <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center' }} className="muted">
            No located assets yet.
          </div>
        )}
      </div>

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
