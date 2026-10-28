# Deploy the customer App Runner

These are prepared deployment templates, not an already provisioned host. The
portable runtime runs on Node.js 22+ without npm install. The SDK must sit beside
it in `packages/tickrmeter-display-sdk`; customer code belongs in `my-app`.
Keep `Dockerfile.dockerignore` beside the Dockerfile: it restricts the build
context to the runtime files, excluding customer code, secrets and generated output.
Use the customer's existing service management and secrets where available.
The agent must have authorized execution/deployment access, not just MCP access.

The container/proxy recipe below describes **version 1 public delivery**. For
private host preparation, use the [version 2 configuration](../README.md#private-host-preparation).
Current firmware cannot retrieve private feeds. Do not register private addresses
with the public-feed API or upload sensitive previews to TickrMeter.

Private mode terminates TLS in the runner: provide a matching certificate and
protected key file, the hash-only credential store and a private output directory.
LAN mode binds a selected RFC1918 interface; no port forwarding is needed. Internet
mode binds loopback and requires an HTTPS upstream proxy with certificate validation,
the configured Host and Authorization header preserved, no redirects and no caching.
Never expose the output directory through static hosting, bypass authentication at
the proxy, or replace HTTPS with HTTP. Mount only required files for the dedicated
runtime user; containers must use the same UID as the owner-private files.

Use generated read tokens from protected files, never provider credentials or
command-line token literals. Test anonymous and revoked access to BOTH the feed
and bitmap and verify TLS identity before calling the host prepared. This remains
host-only testing until secure local pairing and device retrieval are implemented.

## Linux server container

From the root containing the two extracted packages, first initialize and test:

```sh
node packages/tickrmeter-app-runner/bin/tickrmeter-app-runner.js init ./my-app --template clock
node packages/tickrmeter-app-runner/bin/tickrmeter-app-runner.js once ./my-app/runner.json
node packages/tickrmeter-app-runner/bin/tickrmeter-app-runner.js doctor ./my-app/runner.json
```

Inspect the local preview. Replace the example `publicBaseUrl` with the approved
real HTTPS origin. Enable `acknowledgePublicData` only for synthetic or explicitly
public content. All feed/frame HTTP requests are blocked otherwise; local files
remain usable for private previews. Today's firmware cannot authenticate a feed.

Ensure `my-app` is writable by the non-root container user (UID/GID 1000 by default;
override with `TICKRMETER_UID`/`TICKRMETER_GID` to match the approved host user).
The container executes trusted customer modules with that user's permissions;
this is not an untrusted plugin sandbox. Keep other customers' code in separate
deployments. Map only specifically needed provider secrets through the host's
secret mechanism/environment, not the image, code, feed, URL or conversation.

When deployment and any costs are authorized:

```sh
docker compose -f packages/tickrmeter-app-runner/deploy/compose.yaml up -d --build
docker compose -f packages/tickrmeter-app-runner/deploy/compose.yaml logs --tail 30
docker compose -f packages/tickrmeter-app-runner/deploy/compose.yaml down
```

This uses Linux host networking so the runner's loopback binding is reachable by
the host's existing reverse proxy. It opens no public port and creates no domain,
certificate, firewall rule or tunnel. It is not the Windows/macOS Docker Desktop
recipe. The base image tag is a maintenance channel; select and record a reviewed
image digest for a repeatable production release using the Docker build argument
`NODE_IMAGE`. Keep the extracted bundle version/hashes for rollback. Restart the
service to load app code/configuration changes. Do not replace a working runtime
or approve an image update silently.

The HTTPS proxy must forward `/apps/<id>/feed.json` and
`/apps/<id>/frames/<sha256>.bin` to the configured loopback port (8787 by default).
Serve no other customer project files. Preserve Content-Length and content types;
disable redirects, compression, chunked transfer and feed caching. Device DNS
must resolve to public IPv4, and its certificate chain must be supported by the
firmware. A working browser request alone is not proof of device compatibility.

## Existing service manager or own computer

Use `node <absolute-runner-cli> start <absolute-runner.json>` as the service command
with the customer's existing OS service manager. It must restart on failure and
after reboot, with an explicit working directory, dedicated runtime user and
only needed secrets. The runtime handles recurring rendering; do not run a
second overlapping scheduler against the same output directory.

Windows/macOS service installation and HTTPS gateways are not automated in this
release. Prepare the specific service definition for review; do not silently
change startup, sleep, firewall or router settings. A laptop must remain awake
and online; a coding-agent sandbox or open terminal is not permanent hosting.

## Acceptance before claiming completion

1. Fetch authorized provider data, render twice at distinct scheduled times and
   verify true `observedAt` values. Do not turn cached data into a fresh observation.
2. Exercise provider failure/recovery in a safe test: preserve last-good output,
   report failure and respect retry limits. `doctor` checks local configuration
   and saved files only; it cannot verify remote HTTPS, supervision or a device.
3. Check the actual external feed and matching frame: HTTP200, exact lengths,
   types, hash, same origin and no transfer encoding/content encoding/redirect.
4. Check supervised startup/restart and continued updates after the agent chat
   closes. An untested container template must be reported as unverified.
5. Save the real URL with `update_app`, then its current preview with `preview_app`.
   Send only after the user chooses/approves the device. Check physical output
   separately from server/broker acceptance.

The runtime publishes to customer disk/hosting. It never signs in to TickrMeter,
stores an agent management token, creates a paid server or sends to a device.
