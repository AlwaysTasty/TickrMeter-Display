'use strict';

// Shared data + formatting logic for the SLS market face. Used by both the
// Vercel endpoints (api/) and the App Runner module (market.cjs).

const SETTINGS = Object.freeze({
  symbol: 'SLS',                 // SELLAS Life Sciences Group (Nasdaq)
  timeZone: 'Asia/Singapore',    // clock shown on the display
  hour12: true,                  // false = 24-hour clock
  includeExtendedHours: true,    // pre-market and after-hours count as "open"
  ledWhenOpen: true,             // green when up, red when down; off when closed
  delayedAfterMinutes: 10,       // show DELAYED if quotes stop arriving while open
  quoteEveryClosedMinutes: 30,   // closing price barely changes; save API calls
  statusEveryMinutes: 5,
});

// ------------------------------------------------------------- data source ---
// Finnhub (https://finnhub.io): /quote and /stock/market-status. The API key
// is read from the host's environment and never leaves the server.
const API = 'https://finnhub.io/api/v1';
const cache = { quote: null, quoteAt: 0, status: null, statusAt: 0 };

async function finnhub(path, apiKey, signal) {
  const response = await fetch(`${API}${path}`, { headers: { 'X-Finnhub-Token': apiKey }, signal });
  if (!response.ok) throw new Error(`HTTP_${response.status}`);
  return response.json();
}

// Fallback when market status is unavailable: NYSE/Nasdaq hours, weekdays only
// (no holiday calendar). Returns 'pre' | 'regular' | 'post' | null.
function localSession(now) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', weekday: 'short', hour: 'numeric', minute: 'numeric', hourCycle: 'h23',
  }).formatToParts(now).map(p => [p.type, p.value]));
  if (['Sat', 'Sun'].includes(parts.weekday)) return null;
  const minutes = Number(parts.hour) * 60 + Number(parts.minute);
  if (minutes >= 240 && minutes < 570) return 'pre';
  if (minutes >= 570 && minutes < 960) return 'regular';
  if (minutes >= 960 && minutes < 1200) return 'post';
  return null;
}

const SESSION_NAMES = { 'pre-market': 'pre', regular: 'regular', 'post-market': 'post' };

function isOpen(session) {
  return session === 'regular' || (SETTINGS.includeExtendedHours && (session === 'pre' || session === 'post'));
}

/** Refresh cached status/quote as needed. Returns { session, quote, quoteAt }. */
async function snapshot(now, apiKey, signal) {
  const t = now.getTime();
  if (!cache.status || t - cache.statusAt >= SETTINGS.statusEveryMinutes * 60e3) {
    try {
      const s = await finnhub('/stock/market-status?exchange=US', apiKey, signal);
      // Rely on `session` (pre-market / regular / post-market / null), not isOpen,
      // which only describes the regular session.
      cache.status = { session: SESSION_NAMES[s.session] ?? null, holiday: s.holiday || null };
      cache.statusAt = t;
    } catch { /* keep the previous status or fall back to the local schedule */ }
  }
  const session = cache.status && t - cache.statusAt < 30 * 60e3 ? cache.status.session : localSession(now);
  const open = isOpen(session);

  if (!cache.quote || open || t - cache.quoteAt >= SETTINGS.quoteEveryClosedMinutes * 60e3) {
    try {
      const q = await finnhub(`/quote?symbol=${encodeURIComponent(SETTINGS.symbol)}`, apiKey, signal);
      if (!Number.isFinite(q.c) || q.c <= 0 || !q.t) throw new Error('NO_QUOTE'); // unknown symbols return zeros
      cache.quote = q;
      cache.quoteAt = t;
    } catch (error) {
      if (!cache.quote) throw error; // nothing to show yet
    }
  }
  return { session, open, quote: cache.quote, quoteAt: cache.quoteAt };
}

// -------------------------------------------------------------- formatting ---
const money = v => (!Number.isFinite(v) ? '--' : Math.abs(v) >= 1
  ? v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : v.toFixed(4));
const pct = v => (!Number.isFinite(v) ? '--' : `${v >= 0 ? '+' : '-'}${Math.abs(v).toFixed(2)}%`);

function clock(now) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
    timeZone: SETTINGS.timeZone, weekday: 'long', day: 'numeric', month: 'long',
    hour: 'numeric', minute: '2-digit', hourCycle: SETTINGS.hour12 ? 'h12' : 'h23',
  }).formatToParts(now).map(p => [p.type, p.value]));
  return {
    time: `${SETTINGS.hour12 ? String(Number(parts.hour)) : parts.hour.padStart(2, '0')}:${parts.minute}`,
    ampm: SETTINGS.hour12 ? (parts.dayPeriod || '').toUpperCase().replace(/\./g, '') : null,
    day: parts.weekday.slice(0, 3).toUpperCase(),
    date: `${parts.day} ${parts.month.slice(0, 3)}`.toUpperCase(),
    longDate: `${parts.weekday}, ${parts.day} ${parts.month}`.toUpperCase(),
  };
}

/**
 * Build the renderer model, LED and observation time.
 * observedAt is when the provider last confirmed the price, so re-rendering
 * the clock never makes an old price look fresh.
 */
function buildResult({ session, open, quote, quoteAt }, now) {
  const c = clock(now);
  const common = { symbol: SETTINGS.symbol, price: `$${money(quote.c)}`, change: pct(quote.dp) };
  const face = open
    ? { mode: 'open', ...common, high: money(quote.h), low: money(quote.l), time: c.time, ampm: c.ampm,
      day: c.day, date: c.date, session: session === 'pre' || session === 'post' ? session : undefined,
      delayed: now.getTime() - quoteAt > SETTINGS.delayedAfterMinutes * 60e3 || undefined }
    : { mode: 'closed', ...common, time: c.time, ampm: c.ampm, longDate: c.longDate };
  const up = (quote.dp ?? 0) >= 0;
  const led = open && SETTINGS.ledWhenOpen ? { mode: 'solid', color: up ? 'green' : 'red' } : { mode: 'off', color: 'off' };
  return { observedAt: new Date(Math.min(quoteAt, now.getTime())).toISOString(), face, led };
}

module.exports = { SETTINGS, snapshot, buildResult, localSession, clock, money, pct, _cache: cache };
