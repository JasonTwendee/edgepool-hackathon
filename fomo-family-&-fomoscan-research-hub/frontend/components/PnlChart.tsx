import { useEffect, useMemo, useRef, useState } from 'react';
import { formatDateTimeShort, formatUsdSigned } from '../lib/format';

export interface ChartPoint {
  t: number;
  v: number;
}

interface Props {
  points: ChartPoint[];
  /** Full-detail points for hover inspection (drawn curve may be aggregated). */
  detailPoints?: ChartPoint[];
  /** Caption shown in the empty state, e.g. why there is no curve yet. */
  emptyHint?: string;
  /** True while the dataset is still loading (skeleton instead of empty state). */
  loading?: boolean;
}

const H = 230;
/** Render-only downsampling: full fidelity drives values, stride keeps the
 *  canvas path + hover cheap when a wallet has thousands of points. */
const RENDER_MAX_POINTS = 800;

function stride<T>(arr: T[]): T[] {
  if (arr.length <= RENDER_MAX_POINTS) return arr;
  const k = Math.ceil(arr.length / RENDER_MAX_POINTS);
  const out: T[] = [];
  for (let i = 0; i < arr.length; i += k) out.push(arr[i]);
  if (out[out.length - 1] !== arr[arr.length - 1]) out.push(arr[arr.length - 1]);
  return out;
}

/** Monotone cubic (Fritsch–Carlson) in pixel space: soft curve, no overshoot. */
function traceSmooth(ctx: CanvasRenderingContext2D, pts: Array<{ x: number; y: number }>): void {
  const n = pts.length;
  if (n === 0) return;
  ctx.moveTo(pts[0].x, pts[0].y);
  if (n < 3) {
    for (let i = 1; i < n; i++) ctx.lineTo(pts[i].x, pts[i].y);
    return;
  }
  const h: number[] = [];
  const m: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    const dx = pts[i + 1].x - pts[i].x;
    h.push(dx);
    m.push(dx !== 0 ? (pts[i + 1].y - pts[i].y) / dx : 0);
  }
  const mm = new Array<number>(n).fill(0);
  mm[0] = m[0];
  mm[n - 1] = m[n - 2];
  for (let i = 1; i < n - 1; i++) {
    mm[i] =
      m[i - 1] === 0 || m[i] === 0 || Math.sign(m[i - 1]) !== Math.sign(m[i])
        ? 0
        : (m[i - 1] + m[i]) / 2;
  }
  for (let i = 0; i < n - 1; i++) {
    const dx = h[i] === 0 ? 1 : h[i];
    ctx.bezierCurveTo(
      pts[i].x + dx / 3,
      pts[i].y + (mm[i] * dx) / 3,
      pts[i + 1].x - dx / 3,
      pts[i + 1].y - (mm[i + 1] * dx) / 3,
      pts[i + 1].x,
      pts[i + 1].y,
    );
  }
}

/**
 * Canvas portfolio chart (reference: Phantom-style): smooth curve + gradient,
 * dashed "now" line, no grid/labels/axes. Canvas + devicePixelRatio keeps
 * lines pixel-crisp at any width (SVG non-uniform scaling rasterized poorly).
 * Dots + tooltip are HTML overlays.
 */
export function PnlChart({ points, detailPoints, emptyHint, loading }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [hover, setHover] = useState<number | null>(null);
  const [width, setWidth] = useState(0);

  const model = useMemo(() => {
    // Sanitize: drop non-finite values and collapse degenerate runs
    // (same timestamp / identical repeats) that render as broken spikes.
    const clean: ChartPoint[] = [];
    for (const p of points) {
      if (!Number.isFinite(p.t) || !Number.isFinite(p.v)) continue;
      const prev = clean[clean.length - 1];
      if (prev && prev.t === p.t && prev.v === p.v) continue;
      clean.push(p);
    }
    const deduped: ChartPoint[] = [];
    for (const p of clean) {
      const prev = deduped[deduped.length - 1];
      if (prev && prev.t === p.t) deduped[deduped.length - 1] = p;
      else deduped.push(p);
    }
    if (deduped.length < 2) return null;
    const render = stride(deduped);
    const vs = render.map((p) => p.v);
    const ts = render.map((p) => p.t);
    const dataLo = Math.min(...vs);
    const dataHi = Math.max(...vs);
    const dSpan =
      dataHi === dataLo ? Math.max(1, Math.abs(dataHi) * 0.2) : (dataHi - dataLo) * 1.24;
    const lo = dataLo - (dSpan - (dataHi - dataLo)) / 2;
    let hi = dataHi + (dSpan - (dataHi - dataLo)) / 2;
    if (hi === lo) hi = lo + 1;
    const t0 = Math.min(...ts);
    const t1 = Math.max(...ts);
    const span = t1 === t0 ? 1 : t1 - t0;
    const fx = (t: number) => (t - t0) / span;
    const fy = (v: number) => 1 - (v - lo) / (hi - lo);
    const last = render[render.length - 1];
    // Hover inspects full-detail points when available (the drawn curve may
    // be day-aggregated); the domain still comes from the drawn curve.
    const lookup = detailPoints && detailPoints.length > 0 ? detailPoints : render;
    return { render, fx, fy, last, positive: last.v >= 0, lookup };
  }, [points, detailPoints]);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width ?? 0;
      if (w > 0) setWidth(w);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !model || !wrap) return;
    // Measure live: ResizeObserver state can lag (blank canvas), so read DOM.
    const w = wrap.clientWidth || width;
    if (w <= 0) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(H * dpr);
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, H);
    const stroke = model.positive ? '#49E6D7' : '#F28881';
    // Horizontal gridlines only (brand data-viz).
    ctx.beginPath();
    for (const f of [0.25, 0.5, 0.75]) {
      ctx.moveTo(0, Math.round(H * f) + 0.5);
      ctx.lineTo(w, Math.round(H * f) + 0.5);
    }
    ctx.strokeStyle = '#3F424D';
    ctx.lineWidth = 1;
    ctx.stroke();
    const px = model.render.map((p) => ({
      x: model.fx(p.t) * w,
      y: model.fy(p.v) * H,
    }));
    // Area fill.
    const grad = ctx.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, model.positive ? 'rgba(73,230,215,0.16)' : 'rgba(242,136,129,0.16)');
    grad.addColorStop(1, 'rgba(73,230,215,0)');
    ctx.beginPath();
    traceSmooth(ctx, px);
    ctx.lineTo(px[px.length - 1].x, H);
    ctx.lineTo(px[0].x, H);
    ctx.closePath();
    ctx.fillStyle = grad;
    ctx.fill();
    // Curve: flat Edge Aqua lead line, no glow (brand data-viz).
    ctx.beginPath();
    traceSmooth(ctx, px);
    ctx.strokeStyle = stroke;
    ctx.lineWidth = 2.8;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.stroke();
    // "now" dashed line at the latest point.
    const lastX = px[px.length - 1].x;
    ctx.beginPath();
    ctx.setLineDash([4, 4]);
    ctx.moveTo(lastX, 0);
    ctx.lineTo(lastX, H);
    ctx.strokeStyle = '#3F424D';
    ctx.lineWidth = 1;
    ctx.globalAlpha = 0.7;
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;
    // Hover crosshair (detail point).
    if (hover !== null && model.lookup[hover]) {
      const hp = model.lookup[hover];
      const hx = Math.min(w, Math.max(0, model.fx(hp.t) * w));
      ctx.beginPath();
      ctx.setLineDash([3, 3]);
      ctx.moveTo(hx, 0);
      ctx.lineTo(hx, H);
      ctx.strokeStyle = '#3F424D';
      ctx.lineWidth = 1;
      ctx.globalAlpha = 0.5;
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;
    }
  }, [model, width, hover]);

  function onMove(e: React.MouseEvent<HTMLDivElement>) {
    if (!model || width <= 0) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const frac = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    const r = model.lookup;
    const t = r[0].t + frac * (r[r.length - 1].t - r[0].t);
    let best = 0;
    let bestDist = Infinity;
    r.forEach((p, i) => {
      const d = Math.abs(p.t - t);
      if (d < bestDist) {
        bestDist = d;
        best = i;
      }
    });
    setHover(best);
  }

  if (loading) {
    return (
      <div
        className="flex flex-col gap-2 px-1 py-2 animate-pulse"
        style={{ height: H }}
        aria-label="Loading chart"
      >
        <div className="rounded-lg bg-[#2E313F]" style={{ height: H - 56 }} />
        <div className="rounded bg-[#2A2D3A] h-3 w-2/3" />
        <div className="rounded bg-[#2A2D3A] h-3 w-1/3" />
      </div>
    );
  }

  if (!model) {
    return (
      <div
        className="flex flex-col items-center justify-center gap-1 text-center px-6"
        style={{ height: H }}
      >
        <div className="text-xs font-bold text-[#9397AB]">Not enough data for this range</div>
        {emptyHint && <div className="text-[11px] text-[#75798C]">{emptyHint}</div>}
      </div>
    );
  }

  const stroke = model.positive ? '#49E6D7' : '#F28881';
  const hovered = hover !== null ? model.lookup[Math.min(hover, model.lookup.length - 1)] : null;
  const hoverXpct =
    hovered != null ? Math.min(100, Math.max(0, model.fx(hovered.t) * 100)) : 0;
  const lastXpct = model.fx(model.last.t) * 100;
  const lastYpx = model.fy(model.last.v) * H;

  return (
    <div
      ref={wrapRef}
      className="relative w-full"
      style={{ height: H }}
      onMouseMove={onMove}
      onMouseLeave={() => setHover(null)}
    >
      <canvas ref={canvasRef} className="block w-full cursor-crosshair" style={{ height: H }} />
      {/* "now" dot — HTML so it stays a perfect circle at any width */}
      <span
        className="absolute w-2.5 h-2.5 rounded-full pointer-events-none z-10"
        style={{
          left: `${lastXpct}%`,
          top: lastYpx,
          backgroundColor: stroke,
          transform: 'translate(-50%, -50%)',
          boxShadow: `0 0 0 3px ${stroke}33`,
        }}
      />
      {hovered && (
        <>
          <span
            className="absolute w-2.5 h-2.5 rounded-full bg-[#E9E9ED] pointer-events-none z-10"
            style={{
              left: `${hoverXpct}%`,
              top: Math.min(H, Math.max(0, model.fy(hovered.v) * H)),
              transform: 'translate(-50%, -50%)',
              boxShadow: '0 1px 6px rgba(0,0,0,0.6)',
            }}
          />
          <div
            className="absolute -top-1 -translate-x-1/2 pointer-events-none rounded-lg border border-[#3F424D] bg-[#232532]/95 px-2 py-1 text-center shadow-xl whitespace-nowrap z-10"
            style={{ left: `${hoverXpct}%` }}
          >
            <div
              className={`text-xs font-extrabold ${hovered.v >= 0 ? 'text-[#73DEA4]' : 'text-[#F28881]'}`}
            >
              {formatUsdSigned(Math.round(hovered.v))}
            </div>
            <div className="text-[10px] font-mono text-[#9397AB]">
              {formatDateTimeShort(hovered.t)}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
