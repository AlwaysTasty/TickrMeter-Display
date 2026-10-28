#!/usr/bin/env bash
# Check a deployed feed the way the TickrMeter firmware needs it.
# Usage: tools/check-host.sh https://<site>.netlify.app
set -euo pipefail
ORIGIN="${1%/}"
HOST="${ORIGIN#https://}"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

echo "== Certificate chain (firmware trusts ISRG Root X1, GTS Root R4, Amazon Root CA 1, DigiCert Global Root G2)"
PROXY_ARGS=()
if [ -n "${HTTPS_PROXY:-}" ]; then PROXY_ARGS=(-proxy "$(echo "$HTTPS_PROXY" | sed -E 's#^https?://##; s#/.*$##; s#^[^@]*@##')"); fi
openssl s_client "${PROXY_ARGS[@]}" -connect "$HOST:443" -servername "$HOST" -showcerts </dev/null 2>/dev/null \
  | grep -E '^ *[0-9] s:|^ *i:' | sed 's/^ */  /'

echo "== Feed (no Accept-Encoding, HTTP/1.1, no redirects followed)"
curl -sS --http1.1 -H 'Accept-Encoding:' -D "$TMP/feed.hdr" -o "$TMP/feed.json" "$ORIGIN/feed.json"
grep -iE '^HTTP/1.1 [0-9]|^content-(type|length|encoding)|^transfer-encoding|^location' "$TMP/feed.hdr" | sed 's/^/  /'
echo "  body bytes: $(wc -c < "$TMP/feed.json")"

FRAME_URL="$(node -e 'console.log(JSON.parse(require("fs").readFileSync(process.argv[1])).frame.url)' "$TMP/feed.json")"
SHA="$(node -e 'console.log(JSON.parse(require("fs").readFileSync(process.argv[1])).frame.sha256)' "$TMP/feed.json")"
echo "== Frame"
curl -sS --http1.1 -H 'Accept-Encoding:' -D "$TMP/frame.hdr" -o "$TMP/frame.bin" "$FRAME_URL"
grep -iE '^HTTP/1.1 [0-9]|^content-(type|length|encoding)|^transfer-encoding|^location' "$TMP/frame.hdr" | sed 's/^/  /'
echo "  body bytes: $(wc -c < "$TMP/frame.bin")"
if [ "$(sha256sum "$TMP/frame.bin" | cut -d' ' -f1)" = "$SHA" ]; then echo "  SHA-256 matches feed"; else echo "  SHA-256 MISMATCH"; exit 1; fi
