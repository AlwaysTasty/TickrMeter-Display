# External display feed v1

Portable developer-preview contract for customer-hosted TickrMeter displays. Direct public-feed delivery requires compatible firmware and must be enabled for the TickrMeter installation. An active account can prepare an app before selecting a device. A saved preview validates local bytes; it does not prove hosting or physical delivery. See [README.md](README.md#firmware-status) for preparation and delivery checks.

## Responsibilities

TickrMeter keeps account authorization, device ownership, control settings, heartbeats, battery status and diagnostics. A customer-operated service reads the customer's data sources, renders the frame and serves a small feed plus immutable bitmap over HTTPS. The customer's agent creates/deploys that service through its own hosting access; the agent need not remain running. The display feed is data, never executable code. Customer provider credentials remain on the customer server.

Successful local validation proves file compatibility, not that a device can reach the host, negotiate TLS, authenticate or display the content. The backend preparation API does not fetch customer URLs, so saving a configuration creates no server-side polling or rendering cost. With compatible firmware, direct retrieval uses the customer host for scheduled image refreshes; TickrMeter continues to handle heartbeat and control traffic.

## Feed document

The content is a complete UTF-8 JSON document, at most **2,048 bytes including whitespace**. All fields shown are required. Unknown fields, duplicate keys, unsupported versions and wrong types are rejected; every object uses a closed schema. See the [machine-readable schema](schemas/feed.schema.json). Use the SDK's semantic validation too: JSON Schema alone does not enforce byte length, actual public DNS destinations or the same-origin policy.

```json
{
  "v": 1,
  "frame": {
    "url": "https://display.example.com/frames/a3671594682c80e5f08721602dd0136dd1b6c099160ac98ffa6d5b2fca4ba9af.bin",
    "sha256": "a3671594682c80e5f08721602dd0136dd1b6c099160ac98ffa6d5b2fca4ba9af",
    "format": "tickrmeter-mono-v1"
  },
  "observedAt": "2026-09-28T12:00:00Z",
  "led": { "color": "green", "mode": "solid" }
}
```

This example hash is a fully white frame, for transport verification only.

| Field | Contract |
| --- | --- |
| `v` | Integer `1`. |
| `frame.url` | Absolute HTTPS URL, at most 512 UTF-8 bytes before and after URL normalization, same origin as the configured feed URL. |
| `frame.sha256` | SHA-256 over the exact binary body, 64 lowercase hexadecimal characters. It is not a digest of the PNG, SVG, base64 text or feed. |
| `frame.format` | Exact string `tickrmeter-mono-v1`. |
| `observedAt` | Underlying data's observation time in UTC: `YYYY-MM-DDTHH:mm:ssZ` or with exactly three fractional digits. Invalid calendar dates are rejected. A request or render succeeding does not reset source freshness. |
| `led` | `{ "mode": "off", "color": "off" }` or `mode: "solid"` with `red`, `green`, `blue`, `purple`, `cyan`, `yellow`, `white`. No blink, brightness, expressions or provider credentials. |

The SDK validates timestamp syntax/calendar correctness without reading the clock, so historic reference vectors stay deterministic. The preparation API rejects observation times more than **60 seconds in the future**. Firmware must use trustworthy UTC time and apply the same allowance; lack of a trustworthy clock is a distinct recoverable state, not permission to treat stale data as fresh.

## Frame encoding

`tickrmeter-mono-v1` is exactly **296 × 128 pixels / 4,736 bytes**. There is no header, compression, padding, byte-order mark or base64 wrapper.

- Rows run top to bottom; pixels within each row run left to right.
- The first byte covers `(0,0)` through `(7,0)`; its most significant bit is `(0,0)`.
- Each row is 37 bytes. Byte 37 starts the second row.
- A `1` bit is white; a `0` bit is black.
- Pixel `(x,y)` maps to byte `floor((y*296+x)/8)`, mask `1 << (7-((y*296+x)%8))`.

PNG is only a developer/browser preview format. A `.png` URL cannot be substituted for the `.bin` frame. Customers may render using any library. The SDK's RGBA converter composites transparency over white and sets a white bit when the average RGB intensity is strictly greater than the threshold (default 128). This matches the existing renderer for opaque pixels without exposing that renderer.

Reference vectors:

| Vector | Exact bytes | SHA-256 |
| --- | --- | --- |
| White | 4,736 bytes `ff` | `a3671594682c80e5f08721602dd0136dd1b6c099160ac98ffa6d5b2fca4ba9af` |
| Black | 4,736 bytes `00` | `373e58db31dbad517dfede6bb84a58f4f7d5bf03630597ca677658b8bd136106` |
| Corner/row-boundary pixels | White except byte 0=`7e`, 1=`7f`, 36=`fe`, 37=`7f`, 4735=`fe` | `cd518ac8e0e9e6441f453a71351cac9c44924a900799bd8a64baf17312917375` |

The final vector has black pixels at `(0,0)`, `(7,0)`, `(8,0)`, `(295,0)`, `(0,1)` and `(295,127)` and detects transposition, row stride and bit-order errors.

## Control settings and LED priority

The authenticated control plane, not the feed, selects:

```json
{
  "feedUrl": "https://display.example.com/feed.json",
  "refreshSeconds": 900,
  "ledPolicy": { "mode": "source" },
  "staleAfterSeconds": 3600,
  "staleLed": "off"
}
```

`refreshSeconds` is an integer from **60 to 86,400**, an engineering configuration bound pending physical power tests, not a battery-life promise. `staleAfterSeconds` is at least the refresh interval and at most 604,800 seconds. The server adds version/concurrency metadata; those fields do not belong in customer feeds.

LED policy is one of:

1. `{"mode":"off"}` — always off.
2. `{"mode":"fixed","color":"green"}` — always the chosen supported non-off color, independent of feed and stale status.
3. `{"mode":"source"}` — use the current accepted feed LED while its data is fresh; use `staleLed` (`off` or `yellow`) when its data becomes stale.

Brightness remains the user's existing device setting. `staleLed` only applies to source control. A customer wanting conditional colors computes the condition on its server and publishes the resulting LED state. There is no rule engine or account credential on the device. Turning Off also stops any earlier LED blink behavior.

## Atomic delivery and freshness

1. Parse and validate the whole feed within bounded memory; reject invalid or unsupported content before acting.
2. If the frame hash differs from the last accepted frame, download into a temporary buffer, enforce exactly 4,736 received bytes, and verify SHA-256.
3. Commit the accepted frame and its matching feed metadata together. Apply the effective LED only after the new frame succeeds. A failed image download cannot place today's green LED beside yesterday's value.
4. If the hash is unchanged, do not fetch/repaint that bitmap again. Accept updated `observedAt` and LED together after validating the whole feed. This permits new data with the same displayed value and LED-only changes.
5. If retrieval fails, keep the last complete image and accepted metadata. Freshness is calculated from the last accepted `observedAt`; a newer timestamp in a failed update must not keep the old image fresh. Once stale, apply the configured source-controlled stale LED. Do not blank the display or substitute zero.

Serve immutable hash-named frames before atomically publishing their new feed. Keep old referenced frames long enough for in-flight clients and retries; deleting the old frame immediately on feed replacement can race a device download. The example generator retains them; production hosting needs a deliberate retention/storage policy.

A successful response with unchanged old `observedAt` is still stale. A stale valid frame may be retained/displayed with a stale diagnostic; the source-controlled LED must reflect stale policy. Validate future timestamps before comparing freshness. Avoid writing flash or refreshing e-ink for unchanged frames.

## HTTPS, authentication and destination limits

V1 accepts public DNS hostnames. It excludes userinfo, query strings (including signed URLs), fragments, IP literals, single-label names and reserved/private name suffixes such as `.local`, `.internal`, `.localhost`, `.home.arpa` and `.test`. Hostnames are canonicalized through URL parsing; feed/frame origins must match including the port. Nondefault HTTPS ports are syntactically allowed and require device connectivity testing. HTTP redirects are outside the v1 contract and must fail, not forward credentials elsewhere.

The SDK performs **no network requests**. A domain passing syntax checks may resolve to a private or loopback address. A device retrieval client must resolve and reject nonpublic destinations for every connection, protect against DNS rebinding, verify certificates and hostname, and avoid insecure TLS fallback. A future localhost/LAN-hosting mode needs a separate explicit design; this version does not authorize it.

Source read authority must be kept separate from TickrMeter API/MCP credentials and the customer's email/analytics provider credentials. A protected customer endpoint can use a narrow `Authorization: Bearer …` header for both same-origin feed and frame requests. The provided example server demonstrates this customer-side behavior. **Private authenticated device retrieval is not supported in this release. The saved configuration does not accept or deliver a source secret; the protected server example is for customer-side experimentation only.** No secret belongs in a feed, image URL, documentation prompt, telemetry, returned API configuration or shared setup.

SHA-256 detects content mismatch; by itself it is not authentication. Current direct device output is public and unauthenticated. Keep confidential data in a protected customer service until authenticated device retrieval is supported.

## HTTP transport

Customer responses use `200`, JSON content type for the feed and `application/octet-stream` for the bitmap, exact Content-Length, and no compression/content-encoding. The example serves `Cache-Control: no-store` and always sends full responses. Firmware may implement conditional feed requests using a bounded ETag as an optimization; hosts returning `200` remain compatible. An ETag must change if any feed field changes. A `304` retains the complete previously accepted manifest and cannot advance `observedAt` or reset its stale timer; it is invalid without an accepted cached manifest. Compression, chunked transfer and redirects are not baseline v1 features; bounded chunked support requires separate acceptance testing.


Check your real HTTPS endpoint, its feed and matching frame, subsequent scheduled updates and the physical display separately. [README.md](README.md) contains the SDK commands; [HOSTING_GUIDE.md](HOSTING_GUIDE.md) covers operating the customer runtime.
