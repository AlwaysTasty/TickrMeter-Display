'use strict';

const { WIDTH, HEIGHT, encodeRGBA } = require('..');

// A small deterministic example font avoids shipping the private renderer or
// requiring a font/rasterizer install. Replace this with your preferred renderer.
const glyphs = {
  ' ': ['00000','00000','00000','00000','00000','00000','00000'],
  '0': ['01110','10001','10011','10101','11001','10001','01110'],
  '1': ['00100','01100','00100','00100','00100','00100','01110'],
  '2': ['01110','10001','00001','00010','00100','01000','11111'],
  '3': ['11110','00001','00001','01110','00001','00001','11110'],
  '4': ['00010','00110','01010','10010','11111','00010','00010'],
  '5': ['11111','10000','10000','11110','00001','00001','11110'],
  '6': ['01110','10000','10000','11110','10001','10001','01110'],
  '7': ['11111','00001','00010','00100','01000','01000','01000'],
  '8': ['01110','10001','10001','01110','10001','10001','01110'],
  '9': ['01110','10001','10001','01111','00001','00001','01110'],
  '.': ['00000','00000','00000','00000','00000','00110','00110'],
  '/': ['00001','00001','00010','00100','01000','10000','10000'],
  '%': ['11001','11010','00010','00100','01000','01011','10011'],
  'A': ['01110','10001','10001','11111','10001','10001','10001'],
  'D': ['11110','10001','10001','10001','10001','10001','11110'],
  'E': ['11111','10000','10000','11110','10000','10000','11111'],
  'I': ['01110','00100','00100','00100','00100','00100','01110'],
  'L': ['10000','10000','10000','10000','10000','10000','11111'],
  'M': ['10001','11011','10101','10101','10001','10001','10001'],
  'N': ['10001','11001','10101','10011','10001','10001','10001'],
  'O': ['01110','10001','10001','10001','10001','10001','01110'],
  'P': ['11110','10001','10001','11110','10000','10000','10000'],
  'R': ['11110','10001','10001','11110','10100','10010','10001'],
  'T': ['11111','00100','00100','00100','00100','00100','00100'],
};

function renderEmailOpenRate({ opened, delivered }) {
  if (!Number.isInteger(opened) || !Number.isInteger(delivered) || opened < 0 || delivered < 1 || opened > delivered || delivered > 999999) throw new Error('Expected valid integer email counts.');
  const rgba = Buffer.alloc(WIDTH * HEIGHT * 4, 255);
  const text = (value, y, scale) => {
    const width = (value.length * 6 - 1) * scale;
    if (width > WIDTH - 8 || y + 7 * scale > HEIGHT) throw new Error('Example text does not fit.');
    const start = Math.floor((WIDTH - width) / 2);
    [...value].forEach((letter, index) => {
      const glyph = glyphs[letter];
      if (!glyph) throw new Error('Unsupported example text.');
      glyph.forEach((row, gy) => [...row].forEach((pixel, gx) => {
        if (pixel !== '1') return;
        for (let dy = 0; dy < scale; dy++) for (let dx = 0; dx < scale; dx++) {
          const offset = ((y + gy * scale + dy) * WIDTH + start + index * 6 * scale + gx * scale + dx) * 4;
          rgba.fill(0, offset, offset + 3);
        }
      }));
    });
  };
  text('EMAIL OPEN RATE', 12, 2);
  const value = `${(opened / delivered * 100).toFixed(1)}%`;
  text(value, 40, value.length > 5 ? 6 : 7);
  text(`${opened}/${delivered} OPENED`, 103, 2);
  return encodeRGBA(rgba);
}

module.exports = { renderEmailOpenRate };
