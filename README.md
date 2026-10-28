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
| `netlify/functions/`, `netlify.toml` | Netlify functions (recommended host for the device) |
| `api/`, `vercel.json` | Vercel functions (see the certificate note below) |
| `market-face/core.cjs` | Settings (ticker, time zone, 12/24 h, extended hours, LED) and Finnhub data |
| `market-face/face.cjs` | Pixel renderer for both faces |
| `market-face/logo.cjs` | Converted logo (Σ mark); `logo-wordmark.cjs` is the full-word alternative |
| `market-face/market.cjs`, `runner.json` | Same face for TickrMeter's App Runner on an always-on computer |
| `tools/` | Font/logo converters, previews, local contract test, `check-host.sh` |

## Which host: certificates matter

Current TickrMeter firmware only trusts four root certificates: ISRG Root X1,
GTS Root R4, Amazon Root CA 1 and DigiCert Global Root G2. Checked on 28 Oct 2026:

| Host | Chain served | Device |
| --- | --- | --- |
| `*.netlify.app` | DigiCert Global G2 TLS RSA SHA256 2020 CA1 → DigiCert Global Root G2 | trusted |
| `*.vercel.app` | Google Trust Services WR1 → GTS Root R1 → GlobalSign Root CA | **not trusted** |
| Vercel custom domain | Let's Encrypt YR2 → Root YR → ISRG Root X1 (cross-sign) | should work; needs your own domain |
| AWS Lambda function URL | Amazon RSA 2048 → Amazon Root CA 1 | trusted; heavier setup |

## Deploy to Netlify (free plan)

1. Get a free API key at https://finnhub.io/register.
2. Put this folder in a GitHub repository. In Netlify choose **Add new project → Import an
   existing project**, pick the repository. Leave the build command empty; `netlify.toml`
   sets everything else.
3. Under **Project configuration → Environment variables**, add `FINNHUB_API_KEY`
   (scope: Functions). Paste it yourself; it never needs to be shared anywhere else.
4. Deploy, and pick a site name. The device URL is `https://<site>.netlify.app/feed.json`.

Polling once a minute is about 86,000 function calls a month, well inside the free
plan's monthly credits. On the free plan, running out of credits pauses all sites until
the next month, so avoid other heavy projects on the same account.

Vercel works the same way (import, set `FINNHUB_API_KEY`), but only with a custom domain.
Optional on either host: `PUBLIC_ORIGIN=https://your.domain`.

## Verify before pointing the device at it

```sh
tools/check-host.sh https://<site>.netlify.app
```

This prints the certificate chain, then fetches the feed and frame over HTTP/1.1 without
asking for compression (like the device) and checks: 200, exact `Content-Length`, no
`Transfer-Encoding`/`Content-Encoding`, 4,736-byte frame whose SHA-256 matches the feed.

## Local checks

```sh
node tools/local-test.cjs        # 33 contract checks (Vercel + Netlify handlers), Finnhub mocked
node tools/preview.cjs ./out     # sample PNGs (made-up prices)
python3 tools/convert_logo.py logo.png --crop 0,0,72,109 --max-width 50 --max-height 66
```

Fonts: Inter (SIL Open Font License), pre-rasterised into `font-atlas.cjs`.
The SELLAS logo belongs to its owner; it is converted here for personal display only.
