import type { MemberForce } from '../../lib/ipc';

type Component = 'n' | 'vy' | 'vz' | 't' | 'my' | 'mz';

/** One internal-force component along a member, drawn from the stored stations. */
export function ForceDiagram({ rows, component }: { rows: MemberForce[]; component: Component }) {
  const width = 240;
  const height = 72;
  const pad = 6;
  if (rows.length < 2) {
    return <p className="mt-1 text-[10px] text-fg-muted">Not enough stations for a diagram.</p>;
  }
  const values = rows.map((r) => r[component]);
  const max = Math.max(...values, 0);
  const min = Math.min(...values, 0);
  const span = max - min || 1;
  const x = (station: number) => pad + station * (width - 2 * pad);
  const y = (v: number) => pad + ((max - v) / span) * (height - 2 * pad);
  const baseline = y(0);
  const points = rows.map((r) => `${x(r.station).toFixed(1)},${y(r[component]).toFixed(1)}`);
  const area = `${x(rows[0]!.station).toFixed(1)},${baseline.toFixed(1)} ${points.join(' ')} ${x(
    rows[rows.length - 1]!.station,
  ).toFixed(1)},${baseline.toFixed(1)}`;
  const peak = rows.reduce((best, r) =>
    Math.abs(r[component]) > Math.abs(best[component]) ? r : best,
  );
  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className="mt-1 h-[72px] w-full rounded border border-edge bg-canvas"
      role="img"
      aria-label={`${component.toUpperCase()} along the member`}
    >
      <polygon points={area} fill="var(--kp-accent, #5b9dff)" fillOpacity={0.2} />
      <polyline
        points={points.join(' ')}
        fill="none"
        stroke="var(--kp-accent, #5b9dff)"
        strokeWidth={1.5}
      />
      <line
        x1={pad}
        x2={width - pad}
        y1={baseline}
        y2={baseline}
        stroke="currentColor"
        strokeOpacity={0.4}
      />
      <text
        x={Math.min(Math.max(x(peak.station), 24), width - 24)}
        y={y(peak[component]) + (peak[component] >= 0 ? -3 : 10)}
        textAnchor="middle"
        fontSize={9}
        fill="currentColor"
      >
        {formatValue(peak[component])}
      </text>
    </svg>
  );
}

function formatValue(v: number): string {
  const abs = Math.abs(v);
  return abs >= 100 ? v.toFixed(0) : abs >= 10 ? v.toFixed(1) : v.toFixed(2);
}
