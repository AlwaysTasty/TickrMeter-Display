# TickrMeter App Runner

A maintained customer-side runtime for collecting data, rendering it, and keeping multiple TickrMeter apps updated. You or an AI agent customize the small app module; there is no need to invent another scheduler, bitmap format, or HTTP server. Download it from the signed-in documentation page or obtain the same files through MCP.

This runtime is intended for agent-assisted testing. It runs on Node.js 22 or newer, uses no third-party runtime dependencies, and needs the sibling [`tickrmeter-display-sdk`](../tickrmeter-display-sdk/README.md) folder. Keep the two versioned bundles together:

```text
project/
  packages/tickrmeter-app-runner/
  packages/tickrmeter-display-sdk/
  my-app/runner.json
  my-app/clock.cjs
```

## Quick start

From `project`, use an installed Node.js runtime:

```sh
node packages/tickrmeter-app-runner/bin/tickrmeter-app-runner.js init my-app --template clock
node packages/tickrmeter-app-runner/bin/tickrmeter-app-runner.js once my-app/runner.json
node packages/tickrmeter-app-runner/bin/tickrmeter-app-runner.js status my-app/runner.json
node packages/tickrmeter-app-runner/bin/tickrmeter-app-runner.js doctor my-app/runner.json
```

`init` refuses to overwrite a nonempty directory, including an existing setup. The `metric` template contains labeled synthetic data, not a real email integration. `once` creates `output/<app-id>/preview.png`, `feed.json`, immutable `frames/<sha256>.bin`, and local `status.json`. Inspect the PNG with the user. The same bitmap is used in the feed.

The default is **local preview only**. No HTTP route serves anything until the user has approved public data exposure, `acknowledgePublicData` is true, and a real `publicBaseUrl` replaces the example origin. `doctor` exits with code 1 while these or fresh output are missing; this is an actionable readiness result, not a failed installation.

After hosting is approved, configure the real origin and run:

```sh
node packages/tickrmeter-app-runner/bin/tickrmeter-app-runner.js start my-app/runner.json
```

`start` runs the scheduler and a **127.0.0.1-only HTTP listener** on port 8787. Use a customer-owned HTTPS reverse proxy and a service manager to keep it running after the AI conversation closes. See [deployment instructions](deploy/README.md). This command does not provision infrastructure, buy hosting, create a tunnel, set up operating-system startup, assign a TickrMeter, or upload files to TickrMeter.

Before calling the app finished, the agent must separately verify HTTPS feed and matching-frame retrieval, observe another automatic update, save the real feed address and a fresh preview through TickrMeter's API/MCP, and let the user approve sending. `doctor` checks local configuration and stored output only: its success is not proof of TLS, DNS, external reachability, ongoing scheduling, device compatibility, or physical display output.

## App contract

A local CommonJS `.cjs`, ESM `.mjs`, or appropriately configured `.js` module exports `collect`. This is **trusted customer-owned code**, executing with the user's process permissions. It is not a sandbox for arbitrary marketplace code.

```js
exports.collect = async ({ signal, now, secrets }) => {
  // Replace with the approved provider's API. Always pass signal to fetch.
  // Never send subscription credentials or local AI authentication files.
  const value = 42.5;
  return {
    observedAt: now.toISOString(), // For real data, preserve its true source observation time.
    display: {
      layout: 'metric', title: 'EMAIL OPEN RATE', value: `${value}%`,
      footer: 'LATEST CAMPAIGN', icon: 'mail'
    },
    led: { color: value >= 40 ? 'green' : 'red', mode: 'solid' }
  };
};
```

`now` is a `Date`. `signal` is an `AbortSignal`. `secrets` includes only environment variables explicitly mapped in this app's configuration; it never appears in feeds, diagnostics or previews unless the trusted module itself puts it there. Credentials must remain on the customer's host. Omit `led` to turn the LED off. The SDK validates supported LED colors/modes. Device brightness remains a TickrMeter setting.

Built-in [layouts and text rules](RENDERING.md) include `metric`, `two-metrics`, and `clock`. For a different design, optionally export `async render(result, {signal, now})`, returning an exact 4,736-byte TickrMeter monochrome bitmap. The display SDK also converts supported PNGs. The renderer and collect hook share one timeout; a late result is discarded.

## Configuration

Paths resolve relative to `runner.json`. App modules must be inside that directory. `outputDir` can be relative or absolute; use a dedicated writable directory on a local persistent filesystem, not a shared network filesystem. Run only one process/container per output directory; replicas with different PID namespaces must never share it. Use a stable container hostname for restart recovery. Changing modules/configuration requires a restart. Credential changes in private mode reload on each request.

```json
{
  "version": 1,
  "publicBaseUrl": "https://display.example.com",
  "acknowledgePublicData": false,
  "outputDir": "./output",
  "port": 8787,
  "apps": [{
    "id": "email",
    "module": "./email.cjs",
    "intervalSeconds": 300,
    "timeoutSeconds": 20,
    "staleAfterSeconds": 900,
    "retainFrames": 3,
    "secrets": { "apiToken": "EMAIL_API_TOKEN" }
  }]
}
```

[`schemas/config.schema.json`](schemas/config.schema.json) describes the fields. The runtime additionally validates unique IDs, real module paths, timing relationships, and the SDK's URL policy. The origin must be public HTTPS with no path, embedded credentials, query parameters or fragments. Reserved example.com/org/net domains are deliberately preview-only. Add another entry to `apps` to run another app on the same server (up to 32); do not set up another runtime for every display.

Intervals are 60–86,400 seconds. Timeouts are 1–300 seconds and cannot exceed the interval. Retry delays grow from twice the interval to 64 times the interval, capped at 24 hours, then reset on success. Each app runs independently without overlapping its own work. A collector that ignores abort blocks only its own next run until it settles; `status` reports `COLLECTION_TIMEOUT`. Because this is trusted code, a synchronous infinite loop can block the whole process; use a service manager and review generated modules.

## Private host preparation

**The host supports protected feeds; current TickrMeter firmware does not.** Version 2 prepares the customer server for future secure pairing, certificate trust and authenticated retrieval. It does not enable private URLs in TickrMeter's public-feed API, provision a device credential, or provide a local device configuration API. Keep sensitive previews on the customer computer; do not upload them through the current saved-preview workflow.

Version 1 behavior above is unchanged. To prepare a private host, use a separate output directory and explicit version 2 configuration:

```json
{
  "version": 2,
  "mode": "private",
  "network": "lan",
  "baseUrl": "https://192.168.10.20:8787",
  "bindAddress": "192.168.10.20",
  "tls": { "certificateFile": "./private/cert.pem", "keyFile": "./private/key.pem" },
  "credentialsFile": "./private/credentials.json",
  "outputDir": "./private-output",
  "port": 8787,
  "apps": [{ "id": "sensors", "module": "./sensors.cjs", "intervalSeconds": 300 }]
}
```

LAN mode binds only to the chosen RFC1918 IPv4 interface. The HTTPS origin may use an RFC1918 address or local DNS name. Internet mode uses `"network":"internet"`, a public HTTPS DNS origin and `"bindAddress":"127.0.0.1"`; an existing customer proxy must use authenticated HTTPS upstream and preserve the configured Host. Neither mode opens router ports, changes firewall settings or creates a tunnel. No wildcard listener, HTTP fallback, redirects or credential-bearing URL is accepted.

Provide a PEM certificate matching the origin and an unencrypted PEM key in a protected file. The runner requires a matching, unexpired certificate and TLS 1.2 or newer. A self-signed/local CA certificate is useful for host preparation only after the test client explicitly trusts it; do not disable certificate verification. Device trust installation remains firmware work. Never use the deliberately public synthetic test certificate/key from this repository for deployment.

Create dedicated read credentials, one per output/device, using a new token-file path:

```sh
node packages/tickrmeter-app-runner/bin/tickrmeter-app-runner.js credential-add my-app/runner.json kitchen sensors kitchen-device --token-file my-app/private/kitchen-token.txt
node packages/tickrmeter-app-runner/bin/tickrmeter-app-runner.js credential-list my-app/runner.json
node packages/tickrmeter-app-runner/bin/tickrmeter-app-runner.js credential-rotate my-app/runner.json kitchen --token-file my-app/private/kitchen-token-new.txt
node packages/tickrmeter-app-runner/bin/tickrmeter-app-runner.js credential-revoke my-app/runner.json kitchen
```

`--token-file` is relative to the command's working directory. These commands generate 256-bit random read tokens, write them only to a new protected file, and retain only SHA-256 hashes in the credential store. They never accept tokens as arguments, print token values/hashes or reuse provider/API/account credentials. Existing files are never overwritten. Rotation invalidates the previous token immediately; revocation also takes effect on the next request, without restarting. Read the token into a test client's `Authorization: Bearer …` header from its protected file, without shell interpolation, logs or command-line arguments. Secure transfer to a device is not implemented yet.

The credential store is bounded to 256 records and 128 KiB. Both feed and bitmap, including HEAD, require the same output-scoped token. Private responses use `private, no-store`; there are no unauthenticated previews or diagnostics. Requests are bounded to 600/minute overall and 120/minute per credential, with bounded headers/connections and fixed body lengths. Invalid, missing or corrupt credentials deny access. These limits protect the small runtime; they are not a substitute for a customer's network controls.

The credential directory, token files, key and output directory must be owner-private. The helper creates new directories/files with owner-only POSIX permissions or Windows ACLs limited to the current user, SYSTEM and Administrators; it refuses unsafe existing paths instead of changing their permissions. Keep `private/`, token files, output and keys outside Git/backups shared with others. After verifying no credential command is running, a stale `credentials.json.lock` from an interrupted command may be removed by the operator.

Run `once`, `doctor`, then `start` as above. Private `doctor` reports `privateHostPrepared` separately from `deviceDeliverySupported:false`; success only checks local preparation. `start` uses native HTTPS. A persistent privacy marker prevents a later version 1 config from serving an existing private output directory. Do not remove that marker or publish the directory as static files. Protecting a previously public feed cannot erase copies already downloaded or cached.

## Delivery, recovery and privacy

- When opted into public delivery, only `GET`/`HEAD /apps/<id>/feed.json` and `/apps/<id>/frames/<sha256>.bin` exist. There are no HTTP diagnostics, configuration, secret or preview endpoints. Unknown paths, query strings, traversal attempts and malformed IDs return 404. Responses set exact content length with no compression or chunking. Preserve those properties at the HTTPS proxy.
- **Version 1 public delivery is unauthenticated.** IDs and URLs are not passwords. Do not expose confidential email, financial, customer or corporate information through this mode. Version 2 protects the host's feed and bitmap; private authenticated device retrieval still requires new firmware and secure pairing. A user approval to access provider data does not also approve public display of that data.
- On successful collection, the immutable frame is fully written before the feed is atomically replaced. The PNG is generated from that same frame. A crash cannot commit a feed pointing to an unwritten frame. Output files are fsynced; power-loss durability still depends on the filesystem/platform.
- Failed collection preserves the last good feed, LED state, frame and **original `observedAt`**. Missing or stale data never becomes a fresh zero. Stale state is visible through the local `status`/`doctor` commands and the existing device feed protocol; the runner does not silently override the last good LED.
- Startup validates existing feed/frame output and resumes scheduling. A damaged feed or mismatched frame is not served. A process lock prevents accidental competing writers; a lock from a process that no longer exists is reclaimed on the next start. `start` needs a service manager for automatic restart after a crash/reboot.
- Frame retention keeps the current frame and the newest previous frames up to `retainFrames` (2–32). Devices should retrieve the frame promptly after reading its feed; very old frame URLs can return 404 after rotation.
- Status files and CLI errors contain fixed error codes rather than provider response bodies. The runtime does not log HTTP URLs, headers, tokens or collector errors. Trusted modules must follow the same rule in their own logging. Source credentials, `.env` files and output directories do not belong in Git.

`status` is read-only and reports saved output freshness even when the runner is stopped; it is not a service-health probe. Its `publicDelivery` field means HTTP routes are configured to be enabled, not that a server is running or a device has received anything. `once` reports failure with exit code 1 and retains the old output. SIGINT/SIGTERM abort active work and stop the listener. An uncooperative collector keeps the writer lock until it settles or the process ends; CLI shutdown ends such a process after five seconds.

Lock recovery is deliberately conservative. Linux process-start identity detects PID reuse; different hostnames and unreadable locks fail closed. A crash during the brief atomic lock-acquisition guard can leave `.runner-lock-recovery`. If `OUTPUT_LOCKED` persists, the operator must first verify and stop **all** runner processes/containers using that output directory, then remove only its `.runner.lock` and `.runner-lock-recovery` files before restarting. Never remove locks while another writer might be running; output files and credentials do not need to be deleted.

## Verification

This portable bundle omits the development test tree. Use the local `once`, `status` and `doctor` commands above to check your setup.
