'use strict';

const { WIDTH, HEIGHT, encodeRGBA } = require('../../tickrmeter-display-sdk');
const { GLYPHS, normalizeText, measureText } = require('./font');

class LayoutError extends Error {
  constructor(code, field, message) {
    super(`${message} (${field})`);
    this.name = 'LayoutError';
    this.code = code;
    this.field = field;
  }
}
const fail = (code, field, message) => { throw new LayoutError(code, field, message); };
const keys = (object, allowed, field) => {
  if (!object || typeof object !== 'object' || Array.isArray(object) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(object))) {
    fail('INVALID_DISPLAY', field, 'Expected a plain display object');
  }
  if (Reflect.ownKeys(object).some(key => !allowed.includes(key) ||
      !Object.hasOwn(Object.getOwnPropertyDescriptor(object, key), 'value'))) {
    fail('INVALID_FIELD', field, 'Unsupported display field');
  }
};

function content(value, field, missing = '') {
  if (value === null || value === undefined) return missing;
  if (!['string', 'number'].includes(typeof value) || (typeof value === 'number' && !Number.isFinite(value))) {
    fail('INVALID_TEXT', field, 'Use a string or finite number');
  }
  if (String(value).length > 512) fail('TEXT_TOO_LONG', field, 'Text must contain at most 512 characters');
  const text = normalizeText(String(value));
  if ([...text].some(letter => !GLYPHS[letter])) {
    fail('UNSUPPORTED_CHARACTER', field, 'Use supported Latin text, or provide a custom renderer for this language');
  }
  return text || missing;
}

function fitLabel(text, width, scale = 2) {
  if (measureText(text, scale) <= width) return text;
  let result = text;
  while (result && measureText(`${result.trimEnd()}...`, scale) > width) result = result.slice(0, -1);
  return `${result.trimEnd()}...`;
}

function valueScale(text, width, maximum, minimum, field) {
  for (let scale = maximum; scale >= minimum; scale--) if (measureText(text, scale) <= width) return scale;
  fail('VALUE_TOO_WIDE', field, 'Value would be too small to read; format a shorter value or use a custom renderer');
}

// Original pixel icons, deliberately semantic rather than third-party service logos.
const ICONS = Object.freeze({
  mail: ['11111111111', '10000000001', '11000000011', '10100000101', '10010001001', '10001010001', '10000100001', '10000000001', '11111111111'],
  chart: ['10000000000', '10000000010', '10000001010', '10000010010', '10010100010', '10101000010', '11000000010', '10000000000', '11111111111'],
  person: ['000111000', '001000100', '001000100', '000111000', '000000000', '001111100', '010000010', '100000001', '111111111'],
  bolt: ['000011100', '000111000', '001110000', '011111110', '000111100', '001111000', '001110000', '011000000', '110000000'],
});
const TRENDS = Object.freeze({
  up: ['0001000', '0011100', '0111110', '1111111', '0001000', '0001000', '0001000'],
  down: ['0001000', '0001000', '0001000', '1111111', '0111110', '0011100', '0001000'],
  flat: ['0000000', '0000100', '0000010', '1111111', '0000010', '0000100', '0000000'],
});

function renderLayout(display) {
  keys(display, ['layout', 'title', 'value', 'footer', 'icon', 'trend', 'metrics', 'time', 'date'], 'display');
  const allowed = {
    metric: ['layout', 'title', 'value', 'footer', 'icon', 'trend'],
    'two-metrics': ['layout', 'title', 'metrics', 'footer'],
    clock: ['layout', 'title', 'time', 'date'],
  };
  if (!Object.hasOwn(allowed, display.layout)) fail('UNSUPPORTED_LAYOUT', 'layout', 'Choose metric, two-metrics or clock');
  keys(display, allowed[display.layout], 'display');

  const rgba = Buffer.alloc(WIDTH * HEIGHT * 4, 255);
  const pixel = (x, y) => { const offset = (y * WIDTH + x) * 4; rgba.fill(0, offset, offset + 3); };
  const rectangle = (x, y, width, height) => {
    for (let row = y; row < y + height; row++) for (let col = x; col < x + width; col++) pixel(col, row);
  };
  const drawGlyph = (rows, x, y, scale) => {
    rows.forEach((row, dy) => [...row].forEach((value, dx) => {
      if (value === '1') rectangle(x + dx * scale, y + dy * scale, scale, scale);
    }));
  };
  const text = (value, x, y, scale) => {
    for (const letter of value) {
      drawGlyph(GLYPHS[letter].rows, x, y, scale);
      x += (GLYPHS[letter].width + 1) * scale;
    }
  };
  const centered = (value, y, scale, x = 16, width = WIDTH - 32) => {
    text(value, x + Math.floor((width - measureText(value, scale)) / 2), y, scale);
  };
  const label = (value, y, x = 16, width = WIDTH - 32) => centered(fitLabel(value, width), y, 2, x, width);

  const title = content(display.title, 'title');
  if (display.layout === 'metric') {
    if (display.icon !== undefined && !Object.hasOwn(ICONS, display.icon)) fail('INVALID_ICON', 'icon', 'Choose mail, chart, person or bolt');
    if (display.trend !== undefined && !Object.hasOwn(TRENDS, display.trend)) fail('INVALID_TREND', 'trend', 'Choose up, down or flat');
    const icon = ICONS[display.icon];
    const trend = TRENDS[display.trend];
    if (icon) {
      const iconWidth = icon[0].length * 2;
      const shortTitle = fitLabel(title, WIDTH - 32 - iconWidth - 10);
      const groupWidth = iconWidth + (shortTitle ? 10 + measureText(shortTitle, 2) : 0);
      const x = Math.floor((WIDTH - groupWidth) / 2);
      drawGlyph(icon, x, 9, 2);
      text(shortTitle, x + iconWidth + 10, 11, 2);
    } else label(title, 11);
    const value = content(display.value, 'value', '--');
    const scale = valueScale(value, WIDTH - 32, 8, 5, 'value');
    centered(value, 40 + Math.floor((56 - scale * 7) / 2), scale);
    const footer = content(display.footer, 'footer');
    if (trend) {
      const shortFooter = fitLabel(footer, WIDTH - 32 - 24);
      const groupWidth = 14 + (shortFooter ? 10 + measureText(shortFooter, 2) : 0);
      const x = Math.floor((WIDTH - groupWidth) / 2);
      drawGlyph(trend, x, 107, 2);
      text(shortFooter, x + 24, 107, 2);
    } else label(footer, 107);
  } else if (display.layout === 'two-metrics') {
    if (!Array.isArray(display.metrics) || display.metrics.length !== 2) fail('INVALID_METRICS', 'metrics', 'Supply exactly two metrics');
    label(title, 10);
    rectangle(16, 33, WIDTH - 32, 1);
    rectangle(147, 43, 1, 53);
    display.metrics.forEach((metric, index) => {
      const field = `metrics[${index}]`;
      keys(metric, ['label', 'value'], field);
      const value = content(metric.value, `${field}.value`, '--');
      const width = 119;
      const x = index === 0 ? 16 : 161;
      const scale = valueScale(value, width, 5, 3, `${field}.value`);
      centered(value, 45 + Math.floor((35 - scale * 7) / 2), scale, x, width);
      label(content(metric.label, `${field}.label`), 84, x, width);
    });
    label(content(display.footer, 'footer'), 108);
  } else {
    label(title, 10);
    const time = content(display.time, 'time', '--');
    const scale = valueScale(time, WIDTH - 32, 9, 5, 'time');
    centered(time, 34 + Math.floor((63 - scale * 7) / 2), scale);
    label(content(display.date, 'date'), 107);
  }
  return encodeRGBA(rgba);
}

module.exports = { renderLayout, LayoutError };
