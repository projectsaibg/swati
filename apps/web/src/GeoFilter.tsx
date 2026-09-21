import { useEffect, useMemo, useState } from 'react';
import { GeoQuery, GeoTree, api } from './api';

const ALL = '';

/**
 * Cascading District -> Block -> Zone filter shared by every multi-site screen
 * (Assets, Water Quality). Emits the selected GeoQuery; parent screens pass it
 * to their data endpoint so KPIs recompute for the chosen scope. Default (no
 * selection) means all districts aggregated.
 */
export function GeoFilter({ value, onChange }: { value: GeoQuery; onChange: (v: GeoQuery) => void }) {
  const [tree, setTree] = useState<GeoTree>({ districts: [] });
  useEffect(() => { api.geoTree().then(setTree).catch(() => {}); }, []);

  const district = value.district ?? ALL;
  const block = value.block ?? ALL;
  const zone = value.zone ?? ALL;

  const blocks = useMemo(
    () => tree.districts.find((d) => d.name === district)?.blocks ?? [],
    [tree, district],
  );
  const zones = useMemo(
    () => blocks.find((b) => b.name === block)?.zones ?? [],
    [blocks, block],
  );

  return (
    <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
      <select className="input" value={district} onChange={(e) => onChange({ district: e.target.value || undefined })}>
        <option value={ALL}>All districts</option>
        {tree.districts.map((d) => <option key={d.name} value={d.name}>{d.name}</option>)}
      </select>
      <select
        className="input"
        value={block}
        disabled={!district}
        onChange={(e) => onChange({ district: district || undefined, block: e.target.value || undefined })}
      >
        <option value={ALL}>All blocks</option>
        {blocks.map((b) => <option key={b.name} value={b.name}>{b.name}</option>)}
      </select>
      <select
        className="input"
        value={zone}
        disabled={!block || zones.length === 0}
        onChange={(e) => onChange({ district: district || undefined, block: block || undefined, zone: e.target.value || undefined })}
      >
        <option value={ALL}>{block && zones.length === 0 ? 'No zones' : 'All zones'}</option>
        {zones.map((z) => <option key={z} value={z}>{z}</option>)}
      </select>
      {(district || block || zone) && (
        <button className="btn ghost sm" onClick={() => onChange({})}>Clear</button>
      )}
    </div>
  );
}
