# TickrMeter display SDK — developer preview

Portable Node.js 18+ tools for preparing a customer-hosted TickrMeter display.
This package is available through TickrMeter's signed-in documentation downloads
and developer MCP service. It is not
an npm release and does not make the TickrMeter platform open source. Publication
and licensing terms for a future public package have not been finalized.

## Private host preparation

Read MCP tool `get_private_feed_guide` before handling private or licensed output.
Use `validatePrivateSourceUrl`, `validatePrivateFeed`, `buildPrivateFeed` and
`validatePrivateDestinationAddress` explicitly with `network: 'lan'` or
`network: 'internet'`. LAN permits RFC1918 IPv4 peers; internet requires public
IPv4 peers. Both require HTTPS and same-origin feed/image URLs. URL validation
does not resolve DNS, check connected peers or establish TLS trust. Keep the
default public validators unchanged and use the protected App Runner rather
than the public example server. Private device delivery and secure pairing are
not implemented; these helpers cannot enable them. Keep real previews local
unless uploading is explicitly approved.

## Quick start

The core has no dependencies; no install step is required. In this directory:

```sh
node examples/generate.js --out ./display-output --base-url https://display.example.com
```

The example produces synthetic email-open-rate data, preview.png, feed.json and
frames/<sha256>.bin. It does not access an email account, deploy hosting or contact
a device. Read [HOSTING_GUIDE.md](HOSTING_GUIDE.md) to choose an existing server,
a new customer-owned service or your own computer. Your background runtime can
run independently of the coding agent.

## Convert and validate

```sh
node bin/tickrmeter-display.js convert artwork.png frame.bin
node bin/tickrmeter-display.js preview frame.bin preview.png
node bin/tickrmeter-display.js validate feed.json frame.bin --feed-url https://display.example.com/feed.json
```

Artwork must be 296 by 128. PNG support is noninterlaced 8-bit grayscale,
grayscale+alpha, RGB, RGBA or indexed color. Unsupported exports should be
converted to 8-bit RGBA first. Raw .rgba input is also supported. The optional
SVG adapter requires separately installed @resvg/resvg-js@2.6.2; it is never
downloaded automatically. Only render trusted self-contained local SVG artwork.

## Node API

```js
const display = require('./index.js');
const bitmap = display.encodeRGBA(rgbaPixels);
const hash = display.hashBitmap(bitmap);
const feed = display.buildFeed({
  bitmap,
  frameUrl: `https://display.example.com/frames/${hash}.bin`,
  feedUrl: 'https://display.example.com/feed.json',
  observedAt: providerObservationTime,
  led: { mode: 'solid', color: 'green' },
});
const png = display.bitmapToPng(bitmap);
```

The pixel buffer and observation time come from your application. The complete
example demonstrates atomic publication: immutable frame first, then feed.
Retain the underlying observation timestamp when provider data is stale.

Read [PROTOCOL.md](PROTOCOL.md) for the exact frame, LED and freshness rules and
[the JSON schema](schemas/feed.schema.json) for machine-readable fields. The
runtime validator adds URL, byte-size, calendar and same-origin checks. It does
not contact hosts or prove device reachability. TypeScript declarations are in
index.d.ts; browser.js exposes metadata without Node crypto/zlib imports.

## Firmware status

Public-feed delivery is an operator-enabled delivery. Read the live
get_capabilities and list_delivery_devices tools; this static SDK does not know
the installation's gate or a device's firmware. With explicit devices:control
consent, assign_app can request delivery of a previewed app. Read get_delivery
afterward. Broker acceptance of a request is not proof of physical output.
Use retry_delivery for uncertain requests and restore_display to end a test.

For synthetic or explicitly public output, run
`node examples/public-server.js ./display-output` behind an approved HTTPS
reverse proxy. Schedule the generator separately. The firmware requires public
IPv4 DNS, same-origin feed/frame, exact Content-Length, no redirects, compression
or chunking, and a supported CA chain. See HOSTING_GUIDE.md for endpoint checks.

Private device delivery and source-read credentials remain unsupported. The
separate protected examples/server.js demonstrates customer-side authentication
only; it cannot serve the current firmware. TickrMeter management tokens are
separate from source-read credentials.

## Transfer integrity

Verify each supplied file's SHA-256 over its UTF-8 content before writing it.
The bundle digest is SHA-256 of JSON.stringify(files.map(({path, sha256}) =>
({path, sha256}))) in the supplied order. These hashes detect transfer changes;
they are not signatures and do not replace authenticated transport. Write
only the listed relative paths beneath your selected project directory.
