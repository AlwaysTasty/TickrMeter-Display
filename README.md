# SLS market face for TickrMeter

Two faces for a 296 × 128 TickrMeter, redrawn every minute:

- **Market open** (pre-market, regular and after-hours): black bar with `SLS` and the
  SELLAS Σ mark; price with a PRE-MARKET / AFTER-HOURS tag outside the regular session;
  time with day and date; % change with the day's high and low. LED green when up,
  red when down.
- **Market closed**: `SLS · price · %` band and a large clock with the day and date.
  LED off.

US hours in Singapore time: pre-market 16:00, regular 21:30–04:00, after-hours until
08:00 (one hour later for each after US clocks change on 1 Nov 2026). Exchange
holidays come from Finnhub's market status.

## How it is served

`/feed.json` (polled by the device every 60 s) fetches the quote, renders the current
minute and returns a feed pointing at `/frame/<signed text>.bin`. The frame endpoint
re-renders that signed text byte-for-byte, so the service is stateless and needs no
storage. Responses carry an exact `Content-Length`, no redirects, and the feed is
`no-store`.

| Path | What |
| --- | --- |
| `api/feed.js`, `api/frame.js`, `vercel.json` | Vercel endpoints and routes |
| `market-face/core.cjs` | Settings (ticker, time zone, 12/24 h, extended hours, LED) and Finnhub data |
| `market-face/face.cjs` | Pixel renderer for both faces |
| `market-face/logo.cjs` | Converted logo (Σ mark); `logo-wordmark.cjs` is the full-word alternative |
| `market-face/market.cjs`, `runner.json` | Same face for TickrMeter's App Runner on an always-on computer |
| `tools/` | Font/logo converters, previews, local contract test |

## Deploy to Vercel (free Hobby plan)

1. Get a free API key at https://finnhub.io/register.
2. Put this folder in a GitHub repository, then in Vercel choose **Add New → Project**
   and import it. Framework preset: **Other**. No build command.
3. Before deploying, add the environment variable `FINNHUB_API_KEY` (Production).
   Paste it into Vercel yourself; it never needs to be shared anywhere else.
4. Deploy. The device URL is the **production** domain:
   `https://<project>.vercel.app/feed.json` (not a per-deployment URL, which Vercel may
   protect with a login).

Optional: `PUBLIC_ORIGIN=https://your.domain` if you add a custom domain.

## Verify before pointing the device at it

From any terminal (`-H 'Accept-Encoding:'` mimics the device, which doesn't ask for compression):

```sh
curl -s --http1.1 -D - -o feed.json -H 'Accept-Encoding:' https://<project>.vercel.app/feed.json
# expect: HTTP/1.1 200, content-type application/json, content-length, no transfer-encoding
curl -s --http1.1 -D - -o frame.bin -H 'Accept-Encoding:' "$(node -e 'console.log(require("./feed.json").frame.url)')"
# expect: 200, application/octet-stream, content-length: 4736
sha256sum frame.bin   # must equal frame.sha256 in feed.json
```

The device trusts only ISRG Root X1, GTS Root R4, Amazon Root CA 1 and DigiCert Global
Root G2. Vercel uses Let's Encrypt; confirm the served chain reaches ISRG Root X1 (for
example with an SSL checker). If the device can't connect, AWS Lambda function URLs
(Amazon Root CA 1) are the fallback host.

## Local checks

```sh
node tools/local-test.cjs        # 29 contract checks, Finnhub mocked
node tools/preview.cjs ./out     # sample PNGs (made-up prices)
python3 tools/convert_logo.py logo.png --crop 0,0,72,109 --max-width 50 --max-height 66
```

Fonts: Inter (SIL Open Font License), pre-rasterised into `font-atlas.cjs`.
The SELLAS logo belongs to its owner; it is converted here for personal display only.
