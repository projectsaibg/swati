import { useEffect, useState } from 'react';
import { Device, Measurement, Transport, api } from './api';

const DEVICE_TYPES = [
  { v: 'FLOW_METER', l: 'Flow meter' },
  { v: 'PRESSURE_SENSOR', l: 'Pressure sensor' },
  { v: 'WATER_LEVEL', l: 'Water level' },
  { v: 'CHLORINATOR', l: 'Chlorinator' },
  { v: 'MOTOR_PUMP', l: 'Motor-pump' },
];
const TRANSPORTS: Transport[] = ['MQTT', 'LORAWAN', 'WIFI', 'SIM', 'RTU_MODBUS', 'HTTP'];

function errMsg(e: any): string {
  return e?.response?.data?.message ?? e?.message ?? 'Request failed';
}

export function AdminDevices() {
  const [devices, setDevices] = useState<Device[]>([]);
  const [error, setError] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const [readings, setReadings] = useState<Measurement[]>([]);

  // register form
  const [tag, setTag] = useState('');
  const [name, setName] = useState('');
  const [type, setType] = useState('FLOW_METER');
  const [transport, setTransport] = useState<Transport>('MQTT');
  const [gatewayId, setGatewayId] = useState('');
  const [lat, setLat] = useState('');
  const [lng, setLng] = useState('');

  const reload = async () => setDevices(await api.devices());
  useEffect(() => { reload().catch((e) => setError(errMsg(e))); }, []);

  const guard = async (fn: () => Promise<void>) => {
    setError('');
    try { await fn(); } catch (e) { setError(errMsg(e)); }
  };

  const register = () =>
    guard(async () => {
      const res = await api.registerDevice({
        tag, name, type, transport,
        gatewayId: gatewayId || null,
        latitude: lat ? parseFloat(lat) : undefined,
        longitude: lng ? parseFloat(lng) : undefined,
      });
      setDevices(res.devices);
      setTag(''); setName(''); setGatewayId(''); setLat(''); setLng('');
    });

  const setTransport2 = (id: string, t: Transport) =>
    guard(async () => setDevices(await api.updateDevice(id, { transport: t })));

  const showReadings = (id: string) =>
    guard(async () => {
      if (open === id) { setOpen(null); return; }
      setReadings(await api.deviceMeasurements(id, undefined, 20));
      setOpen(id);
    });

  return (
    <div>
      {error && <div className="err">{error}</div>}

      <div className="panel">
        <h2 style={{ marginTop: 0 }}>Devices &amp; connectivity</h2>
        <p className="muted">
          IoT field devices (flow meters, pressure, level, chlorinators) push telemetry over the
          selected transport. Unattended devices / RTU modems post to <code>/api/ingest/measurements</code>
          with an ingest key; operator apps post to <code>/api/devices/:id/measurements</code>.
        </p>

        <table className="tbl">
          <thead>
            <tr><th>Tag</th><th>Name</th><th>Type</th><th>Transport</th><th>Gateway</th><th>Last seen</th><th>Latest</th><th></th></tr>
          </thead>
          <tbody>
            {devices.map((d) => (
              <tr key={d.id}>
                <td>{d.tag}</td>
                <td>{d.name}</td>
                <td className="muted">{d.type}</td>
                <td>
                  <select className="inline-input" style={{ width: 120 }} value={d.transport ?? 'HTTP'} onChange={(e) => setTransport2(d.id, e.target.value as Transport)}>
                    {TRANSPORTS.map((t) => <option key={t} value={t}>{t}</option>)}
                  </select>
                </td>
                <td className="muted">{d.gatewayId ?? '—'}</td>
                <td className="muted tnum">{d.lastSeen ? new Date(d.lastSeen).toLocaleString() : '—'}</td>
                <td className="tnum">
                  {d.lastMeasurement
                    ? `${d.lastMeasurement.value} ${d.lastMeasurement.unit ?? ''} (${d.lastMeasurement.metric})`
                    : '—'}
                </td>
                <td><button className="btn ghost sm" onClick={() => showReadings(d.id)}>{open === d.id ? 'Hide' : 'Readings'}</button></td>
              </tr>
            ))}
          </tbody>
        </table>

        {open && (
          <div style={{ marginTop: 12, borderTop: '1px solid var(--line)', paddingTop: 12 }}>
            <strong>Recent measurements</strong>
            {readings.length === 0 ? (
              <p className="muted">No measurements yet.</p>
            ) : (
              <table className="tbl">
                <thead><tr><th>Timestamp</th><th>Metric</th><th>Value</th><th>Unit</th><th>Quality</th><th>Source</th></tr></thead>
                <tbody>
                  {readings.map((m) => (
                    <tr key={m.id}>
                      <td className="tnum">{new Date(m.ts).toLocaleString()}</td>
                      <td>{m.metric}</td>
                      <td className="tnum">{m.value}</td>
                      <td className="muted">{m.unit ?? '—'}</td>
                      <td className="muted">{m.quality ?? '—'}</td>
                      <td className="muted">{m.source}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}
      </div>

      <div className="panel">
        <h2 style={{ marginTop: 0 }}>Register device</h2>
        <div className="rowform">
          <label className="field">Tag<input value={tag} onChange={(e) => setTag(e.target.value)} placeholder="FM-02" /></label>
          <label className="field">Name<input value={name} onChange={(e) => setName(e.target.value)} placeholder="DMA-2 flow meter" /></label>
          <label className="field">Type
            <select value={type} onChange={(e) => setType(e.target.value)}>
              {DEVICE_TYPES.map((t) => <option key={t.v} value={t.v}>{t.l}</option>)}
            </select>
          </label>
          <label className="field">Transport
            <select value={transport} onChange={(e) => setTransport(e.target.value as Transport)}>
              {TRANSPORTS.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </label>
          <label className="field">Gateway / modem<input value={gatewayId} onChange={(e) => setGatewayId(e.target.value)} placeholder="RTU-GW-02" /></label>
          <label className="field">Latitude<input value={lat} onChange={(e) => setLat(e.target.value)} className="inline-input" placeholder="15.20" /></label>
          <label className="field">Longitude<input value={lng} onChange={(e) => setLng(e.target.value)} className="inline-input" placeholder="74.11" /></label>
          <button className="btn" onClick={register} disabled={!tag || !name}>Register</button>
        </div>
      </div>
    </div>
  );
}
