export function formatUsd(value?: number): string {
  if (value === undefined || value === null) return '—';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(value);
}

export function formatUsdSigned(value?: number): string {
  if (value === undefined || value === null) return '—';
  const abs = new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(Math.abs(value));
  return value < 0 ? `-${abs}` : `+${abs}`;
}

export function formatCompactUsd(value?: number): string {
  if (value === undefined || value === null) return '—';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(value);
}

export function shortSignature(sig: string, head = 6, tail = 4): string {
  if (sig.length <= head + tail) return sig;
  return `${sig.slice(0, head)}…${sig.slice(-tail)}`;
}

export function shortAddress(addr: string): string {
  return shortSignature(addr, 4, 4);
}

export function timeAgo(blockTimeSec: number, nowSec: number = Date.now() / 1000): string {  const s = Math.max(0, Math.floor(nowSec - blockTimeSec));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d`;
  const w = Math.floor(d / 7);
  if (w < 5) return `${w}w`;
  return `${Math.floor(d / 30)}mo`;
}

/** Compact absolute datetime: "29/09 14:32". */
export function formatDateTimeShort(blockTimeSec: number): string {
  const d = new Date(blockTimeSec * 1000);
  const date = d.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit' });
  const time = d.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
  return `${date} ${time}`;
}

/** Full absolute datetime: "14:32:05 29/09/2026". */
export function formatDateTimeFull(blockTimeSec: number): string {
  const d = new Date(blockTimeSec * 1000);
  const date = d.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' });
  const time = d.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  return `${time} ${date}`;
}
