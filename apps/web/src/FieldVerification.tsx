import { FormEvent, useEffect, useState } from 'react';
import { FieldVerificationRow, api } from './api';
import { useAuth } from './contexts';

function Photo({ attId }: { attId: string }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let u: string | null = null;
    api.fieldPhoto(attId).then((x) => { u = x; setUrl(x); }).catch(() => setUrl(null));
    return () => { if (u) URL.revokeObjectURL(u); };
  }, [attId]);
  return url
    ? <img src={url} alt="evidence" style={{ width: 200, height: 150, objectFit: 'cover', borderRadius: 8, border: '1px solid var(--line)' }} />
    : <div className="muted" style={{ width: 200, height: 150, display: 'grid', placeItems: 'center', border: '1px solid var(--line)', borderRadius: 8 }}>loading…</div>;
}

export function FieldVerification() {
  const { user } = useAuth();
  const [rows, setRows] = useState<FieldVerificationRow[]>([]);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [ref, setRef] = useState('');
  const [location, setLocation] = useState('');
  const [category, setCategory] = useState('');
  const [notes, setNotes] = useState('');

  const canUpload = !!user?.permissions?.some((p) => p === 'data.enter' || p === '*');

  const load = () => api.fieldVerifications().then(setRows).catch(() => setErr('Could not load field verifications.'));
  useEffect(() => { load(); }, []);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setErr('');
    if (!file) { setErr('Choose a photo to upload.'); return; }
    if (!ref.trim()) { setErr('Reference is required.'); return; }
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append('photo', file);
      fd.append('ref', ref);
      fd.append('location', location);
      fd.append('category', category);
      fd.append('notes', notes);
      await api.createFieldVerification(fd);
      setFile(null); setRef(''); setLocation(''); setCategory(''); setNotes('');
      await load();
    } catch (e: any) {
      setErr(e?.response?.data?.message ?? 'Upload failed.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <div className="exec-head">
        <div>
          <h1 className="exec-title" style={{ fontSize: 26 }}>FIELD VERIFICATION</h1>
          <p className="exec-sub">Evidence-grade photos · server timestamp + EXIF/GPS + watermark</p>
        </div>
      </div>

      {err && <div className="err">{err}</div>}

      {canUpload && (
        <div className="panel">
          <h3 style={{ marginTop: 0 }}>Capture evidence</h3>
          <p className="muted">The server stamps the authoritative upload time, reads the photo's EXIF/GPS, and burns a watermark before storing it.</p>
          <form onSubmit={submit} className="rowform">
            <label className="field">Photo<input type="file" accept="image/*" capture="environment" onChange={(e) => setFile(e.target.files?.[0] ?? null)} /></label>
            <label className="field">Reference<input value={ref} onChange={(e) => setRef(e.target.value)} placeholder="FV-1001" /></label>
            <label className="field">Location<input value={location} onChange={(e) => setLocation(e.target.value)} placeholder="DMA North, valve 12" /></label>
            <label className="field">Category<input value={category} onChange={(e) => setCategory(e.target.value)} placeholder="Leak / Meter / Asset" /></label>
            <label className="field">Notes<input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional" /></label>
            <button className="btn" disabled={busy}>{busy ? 'Uploading…' : 'Upload evidence'}</button>
          </form>
        </div>
      )}

      <div className="sectlabel">Verifications</div>
      {rows.length === 0 && <div className="panel"><p className="muted">No field verifications yet.</p></div>}
      {rows.map((r) => (
        <div className="panel" key={r.id}>
          <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap' }}>
            {r.photos.map((p) => (
              <div key={p.attachmentId}>
                <Photo attId={p.attachmentId} />
              </div>
            ))}
            <div style={{ flex: 1, minWidth: 240 }}>
              <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                <h3 style={{ margin: 0 }}>{r.ref}</h3>
                <span className={`pill ${r.status === 'Verified' ? 'ok' : 'watch'}`}>{r.status}</span>
              </div>
              <table className="tbl" style={{ marginTop: 8 }}>
                <tbody>
                  <tr><td className="muted">Location</td><td>{r.location ?? '—'}</td></tr>
                  <tr><td className="muted">Category</td><td>{r.category ?? '—'}</td></tr>
                  <tr><td className="muted">Verifier</td><td>{r.verifier ?? '—'}</td></tr>
                  <tr><td className="muted">Server time (authoritative)</td><td className="tnum">{r.verifiedAt ? new Date(r.verifiedAt).toLocaleString() : '—'}</td></tr>
                  <tr><td className="muted">EXIF taken</td><td className="tnum">{r.photos[0]?.exifTakenAt ? new Date(r.photos[0].exifTakenAt).toLocaleString() : 'not present'}</td></tr>
                  <tr><td className="muted">GPS</td><td>{r.latitude != null ? `${Number(r.latitude).toFixed(5)}, ${Number(r.longitude).toFixed(5)}` : 'not present'}</td></tr>
                  {r.notes && <tr><td className="muted">Notes</td><td>{r.notes}</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
