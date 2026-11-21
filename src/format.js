'use strict';

/** 1536 -> "1.5 KB" */
function formatBytes(bytes) {
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  let n = bytes;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i++;
  }
  return `${i === 0 ? n : n.toFixed(1)} ${units[i]}`;
}

/** 0 -> "today", 1 -> "1 day ago", 45 -> "1 month ago", 400 -> "1 year ago" */
function formatAge(days) {
  if (days < 1) return 'today';
  if (days < 30) return plural(days, 'day');
  if (days < 365) return plural(Math.floor(days / 30), 'month');
  return plural(Math.floor(days / 365), 'year');
}

function plural(n, word) {
  return `${n} ${word}${n === 1 ? '' : 's'} ago`;
}

/**
 * Turn "1,3-5" into [1,3,4,5]. "a"/"all" means every item.
 * Ignores numbers outside 1..max.
 */
function parseSelection(input, max) {
  const s = String(input).trim().toLowerCase();
  if (s === 'a' || s === 'all') return Array.from({ length: max }, (_, i) => i + 1);
  const picked = new Set();
  for (const part of s.split(/[\s,]+/)) {
    if (!part) continue;
    const m = part.match(/^(\d+)(?:-(\d+))?$/);
    if (!m) continue;
    const start = Number(m[1]);
    const end = m[2] ? Number(m[2]) : start;
    for (let i = Math.min(start, end); i <= Math.max(start, end); i++) {
      if (i >= 1 && i <= max) picked.add(i);
    }
  }
  return [...picked].sort((a, b) => a - b);
}

module.exports = { formatBytes, formatAge, parseSelection };
