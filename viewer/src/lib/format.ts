// Display helpers shared by the pages. Pure functions, tested in Node.

export function formatBytes(bytes: number | null | undefined): string {
  if (bytes == null || !Number.isFinite(bytes)) return '–';
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value >= 100 ? value.toFixed(0) : value.toFixed(1)} ${units[unit]}`;
}

export function formatCount(value: number | null | undefined): string {
  if (value == null) return '–';
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)} M`;
  if (value >= 10_000) return `${Math.round(value / 1000)} k`;
  return value.toLocaleString('en-GB');
}

export function formatDuration(seconds: number | null | undefined): string {
  if (seconds == null || !Number.isFinite(seconds)) return '';
  if (seconds < 1) return '<1 s';
  if (seconds < 60) return `${Math.round(seconds)} s`;
  const minutes = Math.floor(seconds / 60);
  const rest = Math.round(seconds % 60);
  if (minutes < 60) return rest ? `${minutes} min ${rest} s` : `${minutes} min`;
  return `${Math.floor(minutes / 60)} h ${minutes % 60} min`;
}

export function formatDimensions(mm: number[] | null | undefined): string {
  if (!mm || mm.length !== 3) return '–';
  const unit = Math.max(...mm) >= 1000 ? 'm' : mm.every((v) => v >= 10) ? 'cm' : 'mm';
  const scale = unit === 'm' ? 1000 : unit === 'cm' ? 10 : 1;
  return `${mm.map((v) => (v / scale).toFixed(unit === 'mm' ? 0 : 1)).join(' × ')} ${unit}`;
}

/** "3 min ago", "yesterday", or a date, from an ISO string. */
export function formatRelative(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return '–';
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return '–';
  const seconds = Math.round((now - then) / 1000);
  if (seconds < 45) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  if (days === 1) return 'yesterday';
  if (days < 7) return `${days} days ago`;
  return new Date(then).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return (parts.length > 1 ? parts[0][0] + parts[1][0] : (parts[0] ?? '?').slice(0, 2)).toUpperCase();
}

/** Only same-site paths are followed after login, so a crafted link cannot send people elsewhere. */
export function safeNext(next: string | null): string {
  return next && next.startsWith('/') && !next.startsWith('//') && !next.startsWith('/\\') ? next : '/collection';
}

/** Escapes text for HTML, for snippets people paste into other sites (an embed code's title). */
export function escapeHtml(text: string): string {
  const entities: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  return text.replace(/[&<>"']/g, (char) => entities[char]);
}
