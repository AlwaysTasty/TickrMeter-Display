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
| `server/endpoints.cjs` | Feed and frame logic shared by both hosts |
| `server/node-server.cjs`, `render.yaml` | Plain Node server and Render blueprint (current host) |
| `api/`, `vercel.json` | Vercel functions (see the certificate note below) |
| `market-face/core.cjs` | Settings (ticker, time zone, 12/24 h, extended hours, LED) and Finnhub data |
| `market-face/face.cjs` | Pixel renderer for both faces |
| `market-face/logo.cjs` | Converted logo (Σ mark); `logo-wordmark.cjs` is the full-word alternative |
| `market-face/market.cjs`, `runner.json` | Same face for TickrMeter's App Runner on an always-on computer |
| `tools/` | Font/logo converters, previews, local contract test, `check-host.sh` |

## Which host: certificates and response framing matter

Current TickrMeter firmware trusts only ISRG Root X1, GTS Root R4, Amazon Root CA 1 and
DigiCert Global Root G2, and rejects chunked or compressed responses. Checked 28 Oct 2026:

| Host | Certificate chain | Exact Content-Length | Use |
| --- | --- | --- | --- |
| Render (`*.onrender.com`) | GTS WE1 → GTS Root R4 (trusted) | Node sets it; verify live | **current choice (free)** |
| Vercel + your own domain | Let's Encrypt YR2 → Root YR → ISRG Root X1 (trusted) | yes (verified) | later, once you have a domain |
| Vercel (`*.vercel.app`) | GTS WR1 → GTS Root R1 (not trusted) | yes | not usable by the device |
| Netlify (`*.netlify.app`) | DigiCert → Global Root G2 (trusted) | no, always chunked | not usable |

## Deploy to Render (free)

1. Push this folder to your GitHub repository.
2. In Render choose **New → Blueprint**, pick the repository. `render.yaml` creates one
   free web service named `tickrmeter` (start command `node server/node-server.cjs`,
   health check `/healthz`, which spends no API calls).
3. When asked for `FINNHUB_API_KEY`, paste your key yourself.
4. The device URL is `https://<service>.onrender.com/feed.json`.

The free tier sleeps after 15 minutes without requests; the display's once-a-minute polling
keeps it awake, and one always-on service fits the 750 free hours a month.

## Moving to Vercel later

Your Vercel project already runs the same code. Add your domain to it (DNS only, not
proxied), optionally set `PUBLIC_ORIGIN=https://<your domain>`, run the check below, then
point the device at `https://<your domain>/feed.json` and delete the Render service.

## Verify before pointing the device at it

```sh
tools/check-host.sh https://<service>.onrender.com
```

This prints the certificate chain, then fetches the feed and frame over HTTP/1.1 without
asking for compression (like the device) and checks: 200, exact `Content-Length`, no
`Transfer-Encoding`/`Content-Encoding`, 4,736-byte frame whose SHA-256 matches the feed.

## Local checks

```sh
node tools/local-test.cjs        # contract checks for the Vercel handlers and Node server, Finnhub mocked
node tools/preview.cjs ./out     # sample PNGs (made-up prices)
python3 tools/convert_logo.py logo.png --crop 0,0,72,109 --max-width 50 --max-height 66
```

Fonts: Inter (SIL Open Font License), pre-rasterised into `font-atlas.cjs`.
The SELLAS logo belongs to its owner; it is converted here for personal display only.
