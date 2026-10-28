#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const sdk = require('..');
const { writeAtomic, parseArgs } = require('../lib/files');
class CommandError extends Error {}

function main(args) {
  const { options, positional } = parseArgs(args, ['--feed-url', '--threshold', '--font']);
  const [command, input, output] = positional;
  if (positional.length !== 3 || !['convert', 'preview', 'validate'].includes(command)) throw new CommandError('Usage: tickrmeter-display convert input.png|input.svg|input.rgba output.bin [--threshold 128] [--font font.ttf]; preview input.bin output.png; validate feed.json frame.bin --feed-url https://display.example.com/feed.json');
  if ((command !== 'convert' && (options['--font'] || options['--threshold'])) || (command !== 'validate' && options['--feed-url'])) throw new CommandError('Unsupported command option.');
  const threshold = options['--threshold'] === undefined ? undefined : Number(options['--threshold']);
  if (threshold !== undefined && (!Number.isFinite(threshold) || threshold < 0 || threshold > 255)) throw new CommandError('Threshold must be a finite number from 0 to 255.');
  if (command === 'convert') {
    if (fs.statSync(input).size > 1048576) throw new CommandError('Input must be at most 1 MiB.');
    const source = fs.readFileSync(input);
    const extension = path.extname(input).toLowerCase();
    let bitmap;
    if (extension === '.png') bitmap = sdk.pngToBitmap(source, { threshold });
    else if (extension === '.rgba') bitmap = sdk.encodeRGBA(source, { threshold });
    else if (extension === '.svg') {
      // This CLI renders local, trusted artwork only. Disallow external resource
      // declarations even when an optional rasterizer supports reading them.
      const svg = source.toString('utf8');
      if (/<!|<\s*(?:script|foreignObject)\b|href\s*=|url\s*\(|@import/i.test(svg)) throw new CommandError('SVG must be self-contained, without external resources or scripts.');
      const root = svg.match(/<svg\b[^>]*>/i)?.[0] || '';
      if (!/\swidth\s*=\s*['"]296['"]/i.test(root) || !/\sheight\s*=\s*['"]128['"]/i.test(root)) throw new CommandError('SVG root dimensions must be width="296" height="128".');
      let Resvg;
      try { ({ Resvg } = require('@resvg/resvg-js')); } catch { throw new CommandError('SVG conversion requires optional @resvg/resvg-js@2.6.2. PNG and RGBA conversion have no dependencies.'); }
      const rendered = new Resvg(svg, { background: 'white', font: {
        loadSystemFonts: !options['--font'], fontFiles: options['--font'] ? [path.resolve(options['--font'])] : [],
      } }).render();
      if (rendered.width !== sdk.WIDTH || rendered.height !== sdk.HEIGHT) throw new CommandError('SVG dimensions must be 296 by 128.');
      bitmap = sdk.encodeRGBA(rendered.pixels, { threshold });
    } else throw new CommandError('Supported inputs: .png, .svg, .rgba.');
    writeAtomic(output, bitmap);
    process.stdout.write(`Bitmap ready: ${sdk.FRAME_BYTES} bytes; SHA-256 ${sdk.hashBitmap(bitmap)}\n`);
  } else if (command === 'preview') {
    if (fs.statSync(input).size !== sdk.FRAME_BYTES) throw new CommandError('Bitmap must be exactly 4736 bytes.');
    writeAtomic(output, sdk.bitmapToPng(fs.readFileSync(input)));
    process.stdout.write('Preview ready: 296 by 128 pixels.\n');
  } else {
    if (!options['--feed-url']) throw new CommandError('Validation requires --feed-url to enforce same-origin delivery.');
    if (fs.statSync(input).size > sdk.MAX_FEED_BYTES || fs.statSync(output).size !== sdk.FRAME_BYTES) throw new CommandError('Feed or bitmap size is invalid.');
    const feed = sdk.validateFeed(fs.readFileSync(input), { feedUrl: options['--feed-url'] });
    if (sdk.hashBitmap(fs.readFileSync(output)) !== feed.frame.sha256) throw new CommandError('Frame checksum does not match the feed.');
    process.stdout.write('Feed and bitmap valid. Firmware delivery is not enabled by this check.\n');
  }
}

try { main(process.argv.slice(2)); } catch (error) {
  // Filesystem paths and arbitrary rasterizer diagnostics can contain secrets.
  const message = error instanceof sdk.DisplayValidationError || error instanceof CommandError ? error.message :
    'Command failed. Check local file access and command options.';
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
}
