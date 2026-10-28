'use strict';

// Pure renderer for the two-state market face. It never reads the clock or the
// network: collect() supplies every formatted string, so a preview and the
// device frame for the same input are byte-identical.

const ATLAS = require('./font-atlas.cjs');

const W = 296;
const H = 128;
const FRAME_BYTES = (W * H) / 8;

function canvas() {
  const ink = new Uint8Array(W * H); // 1 = black
  const set = (x, y, v) => {
    if (x >= 0 && y >= 0 && x < W && y < H) ink[y * W + x] = v;
  };
  const rect = (x, y, w, h, v = 1) => {
    for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) set(xx, yy, v);
  };
  return { ink, set, rect };
}

const face = (family, size) => {
  const f = ATLAS[family] && ATLAS[family][size];
  if (!f) throw new Error(`No ${family} font at ${size}px`);
  return f;
};

function normalise(text) {
  // A true minus sign for negative numbers; ordinary hyphens elsewhere (PRE-MARKET).
  return String(text).toUpperCase().replace(/-(?=\d)/g, '−');
}

function measure(family, size, text) {
  const f = face(family, size);
  let width = 0;
  for (const ch of normalise(text)) {
    const g = f.g[ch];
    if (!g) throw new Error(`Unsupported character ${JSON.stringify(ch)}`);
    width += g.a;
  }
  // Trim the last glyph's right side bearing so right-alignment is visually tight.
  const last = [...normalise(text)].pop();
  if (last) {
    const g = f.g[last];
    width -= g.a - (g.x + g.w);
  }
  return width;
}

function fit(family, sizes, text, maxWidth) {
  for (const size of sizes) if (measure(family, size, text) <= maxWidth) return size;
  return sizes[sizes.length - 1];
}

function drawText(c, family, size, text, x, baseline, colour = 1, align = 'left') {
  const f = face(family, size);
  const width = measure(family, size, text);
  let pen = align === 'left' ? x : align === 'right' ? x - width : Math.round(x - width / 2);
  for (const ch of normalise(text)) {
    const g = f.g[ch];
    rowsOf(g).forEach((bits, row) => {
      for (let col = 0; col < g.w; col++) if (bits[col]) c.set(pen + g.x + col, baseline + g.y + row, colour);
    });
    pen += g.a;
  }
  return width;
}

const cap = (family, size) => face(family, size).cap;

// Hex rows (leading zeros dropped) -> per-row bit arrays, decoded once per glyph.
const decoded = new WeakMap();
function rowsOf(g) {
  if (!decoded.has(g)) {
    const digits = Math.ceil(g.w / 4);
    const offset = digits * 4 - g.w;
    decoded.set(g, g.r.map(hex => {
      const s = hex.padStart(digits, '0');
      const bits = new Uint8Array(g.w);
      for (let col = 0; col < g.w; col++) {
        const b = col + offset;
        bits[col] = (parseInt(s[b >> 2], 16) >> (3 - (b & 3))) & 1;
      }
      return bits;
    }));
  }
  return decoded.get(g);
}

function drawLogo(c, logo, cx, cy, maxW, maxH) {
  if (!logo) {
    // Placeholder until the real logo is converted with tools/convert_logo.py.
    const s = Math.min(maxW, maxH);
    const x = Math.round(cx - s / 2);
    const y = Math.round(cy - s / 2);
    for (let i = 0; i < s; i += 4) {
      c.rect(x + i, y, 2, 1, 0); c.rect(x + i, y + s - 1, 2, 1, 0);
      c.rect(x, y + i, 1, 2, 0); c.rect(x + s - 1, y + i, 1, 2, 0);
    }
    drawText(c, 'text', 11, 'LOGO', cx, cy + 4, 0, 'center');
    return;
  }
  const x0 = Math.round(cx - logo.w / 2);
  const y0 = Math.round(cy - logo.h / 2);
  rowsOf(logo).forEach((bits, row) => {
    for (let col = 0; col < logo.w; col++) if (bits[col]) c.set(x0 + col, y0 + row, 0); // white on the black bar
  });
}

function hline(c, x0, x1, y, thickness = 2) {
  c.rect(x0, y, x1 - x0, thickness);
}

// ---------- Market open ----------
function renderOpen(c, m) {
  const BAR = 76;
  c.rect(0, 0, BAR, H); // black bar

  // Ticker, white, centred in the bar.
  const tSize = fit('text', [24, 22, 21, 20, 19, 18, 17, 16, 15], m.symbol, BAR - 10);
  const tBase = 8 + cap('text', tSize);
  drawText(c, 'text', tSize, m.symbol, BAR / 2, tBase, 0, 'center');

  const L = BAR + 9;
  const R = W - 6;

  // Row 1: price, with an inverted PRE-MARKET / AFTER-HOURS tag beside it when it fits.
  // The baseline stays fixed so the rows below never shift between sessions.
  const PRICE_SIZES = [42, 40, 38, 36, 34, 32, 30, 28, 26];
  const pBase = 6 + cap('display', PRICE_SIZES[0]);
  const SESSION = { pre: ['PRE-MARKET', 'PRE-MKT'], post: ['AFTER-HOURS', 'AFTER-HRS'] }[m.session];
  const tagW = SESSION ? measure('text', 11, SESSION[0]) + 9 : 0;
  // Shrink the price slightly to make room for the tag, but never below 36 px.
  const withTag = SESSION && measure('display', 36, m.price) + 6 + tagW <= R - L;
  const pSize = fit('display', PRICE_SIZES, m.price, R - L - (withTag ? tagW + 6 : 0));
  drawText(c, 'display', pSize, m.price, L, pBase);
  let barLabel = m.delayed ? 'DELAYED' : null;
  if (SESSION) {
    if (withTag) {
      const tagH = cap('text', 11) + 9;
      const top = Math.round(pBase - cap('display', pSize) / 2 - tagH / 2);
      c.rect(R - tagW, top, tagW, tagH);
      drawText(c, 'text', 11, SESSION[0], R - 4, top + 5 + cap('text', 11), 0, 'right');
    } else if (!barLabel) barLabel = SESSION[1];
  }

  if (barLabel) drawText(c, 'text', 11, barLabel, BAR / 2, H - 6, 0, 'center');
  const logoTop = tBase + 8;
  const logoBottom = barLabel ? H - 20 : H - 8;
  drawLogo(c, m.logo, BAR / 2, Math.round((logoTop + logoBottom) / 2), BAR - 14, logoBottom - logoTop);

  // Row 2: time (prominent) + day/date stacked on the right.
  const dayW = Math.max(measure('text', 17, m.day), measure('text', 17, m.date));
  const timeArea = R - L - dayW - 10;
  const ampmW = m.ampm ? measure('text', 13, m.ampm) + 3 : 0;
  const tmSize = fit('display', [38, 36, 34, 32, 30, 28, 26], m.time, timeArea - ampmW);
  const tmTop = pBase + 12;
  const tmBase = tmTop + cap('display', tmSize);
  const tw = drawText(c, 'display', tmSize, m.time, L, tmBase);
  if (m.ampm) drawText(c, 'text', 13, m.ampm, L + tw + 3, tmTop + cap('text', 13));
  // Day above date, bottom-aligned with the time and separated by a clear gap.
  drawText(c, 'text', 17, m.date, R, tmBase, 1, 'right');
  drawText(c, 'text', 17, m.day, R, tmBase - cap('text', 17) - 5, 1, 'right');

  // Divider.
  const divY = tmBase + 7;
  hline(c, L, R, divY);

  // Row 3: % change, then day's high/low stacked to its right.
  const hl = [`H ${m.high}`, `L ${m.low}`];
  const hlSize = fit('text', [16, 15, 14, 13, 12], hl.reduce((a, b) => (a.length >= b.length ? a : b)), 104);
  const hlW = Math.max(...hl.map(s => measure('text', hlSize, s)));
  const cSize = fit('display', [32, 30, 28, 26, 24], m.change, R - L - hlW - 10);
  const bottom = H - 6;
  drawText(c, 'display', cSize, m.change, L, bottom);
  const hlGap = 4;
  drawText(c, 'text', hlSize, hl[1], R, bottom, 1, 'right');
  drawText(c, 'text', hlSize, hl[0], R, bottom - cap('text', hlSize) - hlGap, 1, 'right');
}

// ---------- Market closed ----------
function renderClosed(c, m) {
  const BAND = 30;
  c.rect(0, 0, W, BAND);
  const items = [m.symbol, m.price, m.change];
  let size = 22;
  const total = s => items.reduce((sum, t) => sum + measure('text', s, t), 0);
  while (size > 14 && total(size) > W - 16 - 2 * 14) size--;
  const base = Math.round(BAND / 2 + cap('text', size) / 2);
  drawText(c, 'text', size, m.symbol, 8, base, 0, 'left');
  drawText(c, 'text', size, m.change, W - 8, base, 0, 'right');
  const left = 8 + measure('text', size, m.symbol);
  const right = W - 8 - measure('text', size, m.change);
  drawText(c, 'text', size, m.price, Math.round((left + right) / 2), base, 0, 'center');

  // Big clock.
  const ampmW = m.ampm ? measure('text', 18, m.ampm) + 6 : 0;
  const ckSize = fit('display', [84, 80, 76, 72, 68, 64, 58], m.time, W - 16 - ampmW);
  const ckW = measure('display', ckSize, m.time);
  const x = Math.round((W - ckW - ampmW) / 2);
  const dateSize = fit('text', [19, 18, 17, 16, 15], m.longDate, W - 16);
  const dateBase = H - 6;
  const ckBase = dateBase - cap('text', dateSize) - 12;
  const ckTop = ckBase - cap('display', ckSize);
  drawText(c, 'display', ckSize, m.time, x, ckBase);
  if (m.ampm) drawText(c, 'text', 18, m.ampm, x + ckW + 6, ckTop + cap('text', 18));
  drawText(c, 'text', dateSize, m.longDate, W / 2, dateBase, 1, 'center');
}

/**
 * model: { mode: 'open'|'closed', symbol, price, change, high, low, time, ampm,
 *          day, date, longDate, delayed, logo }
 * Returns the exact 4,736-byte tickrmeter-mono-v1 frame (1 bit = white).
 */
function renderFace(model) {
  const c = canvas();
  if (model.mode === 'open') renderOpen(c, model);
  else renderClosed(c, model);
  const out = Buffer.alloc(FRAME_BYTES);
  for (let i = 0; i < W * H; i++) if (!c.ink[i]) out[i >> 3] |= 1 << (7 - (i % 8));
  return out;
}

module.exports = { renderFace, measure };
