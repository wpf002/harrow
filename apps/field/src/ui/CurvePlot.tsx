/**
 * Live force-depth curve (§13).
 *
 * Depth runs down the Y axis, because that is the direction the probe travels and a
 * plot the operator has to mentally flip at 07:00 is a plot that gets misread.
 *
 * Raw samples are always drawn. The two-segment fit is drawn over them, never instead
 * of them — §2.1 as a rendering rule. If the fit and the points disagree, the operator
 * should be able to see that happening.
 */
import type { ForceDepthCurve } from '@harrow/shared';

interface Props {
  curve: ForceDepthCurve | null;
  /** Breakpoint depth in mm, when a derivation has been run. */
  cushionDepthMm?: number | null;
  width?: number;
  height?: number;
}

export function CurvePlot({ curve, cushionDepthMm, width = 320, height = 260 }: Props) {
  const pad = { top: 14, right: 14, bottom: 28, left: 44 };
  const plotW = width - pad.left - pad.right;
  const plotH = height - pad.top - pad.bottom;

  if (!curve || curve.depthMm.length < 2) {
    return (
      <svg width="100%" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="No curve yet">
        <rect x={0} y={0} width={width} height={height} fill="var(--h-surface)" rx={10} />
        <text
          x={width / 2}
          y={height / 2}
          textAnchor="middle"
          fill="var(--h-text-muted)"
          fontSize={13}
        >
          awaiting traverse
        </text>
      </svg>
    );
  }

  let maxForce = 0;
  for (const f of curve.forceN) if (f > maxForce) maxForce = f;
  const maxDepth = curve.depthMm[curve.depthMm.length - 1] ?? 1;
  const fScale = maxForce > 0 ? plotW / maxForce : 0;
  const dScale = maxDepth > 0 ? plotH / maxDepth : 0;

  const x = (f: number) => pad.left + f * fScale;
  const y = (d: number) => pad.top + d * dScale;

  const path = Array.from(curve.depthMm)
    .map((d, i) => `${i === 0 ? 'M' : 'L'}${x(curve.forceN[i]!).toFixed(1)},${y(d).toFixed(1)}`)
    .join(' ');

  const forceTicks = [0, maxForce / 2, maxForce];
  const depthTicks = [0, maxDepth / 2, maxDepth];

  return (
    <svg
      width="100%"
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label={`Force-depth curve, peak ${maxForce.toFixed(0)} newtons at ${maxDepth.toFixed(0)} millimetres`}
    >
      <rect x={0} y={0} width={width} height={height} fill="var(--h-surface)" rx={10} />

      {cushionDepthMm != null && cushionDepthMm > 0 && cushionDepthMm < maxDepth && (
        <>
          {/* Cushion band above the transition, base band below. The whole point of the
              instrument is that these are two different things. */}
          <rect
            x={pad.left}
            y={pad.top}
            width={plotW}
            height={y(cushionDepthMm) - pad.top}
            fill="var(--h-signal)"
            opacity={0.06}
          />
          <line
            x1={pad.left}
            x2={pad.left + plotW}
            y1={y(cushionDepthMm)}
            y2={y(cushionDepthMm)}
            stroke="var(--h-signal)"
            strokeDasharray="4 3"
            strokeWidth={1}
          />
          <text
            x={pad.left + plotW}
            y={y(cushionDepthMm) - 4}
            textAnchor="end"
            fill="var(--h-signal)"
            fontSize={10}
            fontFamily="var(--h-mono)"
          >
            cushion {cushionDepthMm.toFixed(0)} mm
          </text>
        </>
      )}

      {forceTicks.map((f) => (
        <g key={`f${f}`}>
          <line
            x1={x(f)}
            x2={x(f)}
            y1={pad.top}
            y2={pad.top + plotH}
            stroke="var(--h-line)"
            strokeWidth={0.5}
          />
          <text
            x={x(f)}
            y={height - 10}
            textAnchor="middle"
            fill="var(--h-text-muted)"
            fontSize={10}
            fontFamily="var(--h-mono)"
          >
            {f.toFixed(0)}
          </text>
        </g>
      ))}
      {depthTicks.map((d) => (
        <text
          key={`d${d}`}
          x={pad.left - 6}
          y={y(d) + 3}
          textAnchor="end"
          fill="var(--h-text-muted)"
          fontSize={10}
          fontFamily="var(--h-mono)"
        >
          {d.toFixed(0)}
        </text>
      ))}

      <path d={path} fill="none" stroke="var(--h-signal)" strokeWidth={1.75} />

      <text x={pad.left} y={height - 10} fill="var(--h-text-muted)" fontSize={10}>
        N
      </text>
      <text x={4} y={pad.top - 3} fill="var(--h-text-muted)" fontSize={10}>
        mm
      </text>
    </svg>
  );
}
