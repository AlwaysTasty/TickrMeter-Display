'use strict';
// Renders sample frames for design review. Usage: node tools/preview.cjs <outDir>
// All prices here are made-up sample values, not market data.
const fs = require('node:fs');
const path = require('node:path');
const sdk = require('../packages/tickrmeter-display-sdk');
const { renderFace } = require('../market-face/face.cjs');

const sigma = require('../market-face/logo-sigma.cjs');
const wordmark = require('../market-face/logo-wordmark.cjs');

const out = process.argv[2] || './preview';
fs.mkdirSync(out, { recursive: true });

const base = { symbol: 'SLS', price: '$2.47', change: '-1.23%', high: '2.55', low: '2.40', day: 'WED', date: '28 OCT' };
const SAMPLES = {
  regression_closed: { mode: 'closed', symbol: 'TICKR', price: '$262.24', change: '-1.23%',
    time: '10:48', ampm: 'AM', longDate: 'WEDNESDAY, 28 OCTOBER' },
  sls_open: { ...base, mode: 'open', time: '10:48', ampm: 'PM', logo: sigma },
  sls_pre: { ...base, mode: 'open', session: 'pre', price: '$2.51', change: '+1.62%', time: '6:15', ampm: 'PM', logo: sigma },
  sls_post: { ...base, mode: 'open', session: 'post', price: '$2.44', change: '-2.40%', time: '5:42', ampm: 'AM', day: 'THU', date: '29 OCT', logo: sigma },
  sls_open_wordmark: { ...base, mode: 'open', time: '10:48', ampm: 'PM', logo: wordmark },
  sls_closed: { ...base, mode: 'closed', time: '11:24', ampm: 'AM', longDate: 'WEDNESDAY, 28 OCTOBER' },
  sls_post_delayed: { ...base, mode: 'open', session: 'post', delayed: true, price: '$1,234.56', change: '+12.34%', high: '1,250.10', low: '1,198.40', time: '12:59', ampm: 'AM', logo: sigma },
};

for (const [name, model] of Object.entries(SAMPLES)) {
  const start = process.hrtime.bigint();
  const bitmap = sdk.validateBitmap(renderFace(model));
  const ms = Number(process.hrtime.bigint() - start) / 1e6;
  fs.writeFileSync(path.join(out, `${name}.png`), sdk.bitmapToPng(bitmap));
  console.log(name.padEnd(20), sdk.hashBitmap(bitmap).slice(0, 12), `${ms.toFixed(1)} ms`);
}
