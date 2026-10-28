# Choose where your TickrMeter integration runs

## Private data first

For household sensors, licensed API data or confidential information, read
`get_private_feed_guide` before selecting hosting. The App Runner now supports
protected HTTPS host preparation on LAN or internet endpoints. This does not
enable private device delivery: secure device pairing, local configuration and
authenticated firmware retrieval are still pending. Keep real private previews
local unless an upload is explicitly approved. Do not publish data or create a
public tunnel to work around the current firmware restriction. The remaining
public-device workflow below applies only to approved nonconfidential output.

## First choose the kind of custom display

**TickrMeter hosted** is recommended for simple values such as free disk space,
email open rates and counts. The AI creates a layout in the existing builder and
prepares a small outbound data collector. TickrMeter stores the chosen values and
renders the screen. No customer web server, domain or public feed is needed.
Read `get_hosted_builder_guide` and `get_hosted_publisher_bundle` through MCP;
these supply the schema, presets and a dependency-free Node.js 20+ publisher.
The same layout remains editable by hand under My setups.

The customer still supplies ongoing source access and an awake/online computer
or service to collect values. TickrMeter manages hosted updates automatically;
do not ask the customer to choose a refresh interval or explain internal quotas
during setup. A push stores values rather than forcing a render.
The publisher's setup-scoped token is separate from AI sign-in and keeps working
after AI disconnect until revoked or rotated. No customer code runs on TickrMeter.
Existing legacy device-image delivery is unauthenticated; do not promise privacy.
Hosted devices are selected with `list_hosted_devices` / `assign_hosted_display`,
using existing page mode and explicit device-control consent.

**Host your own** is for custom rendering, an existing corporate display service,
or customers who choose to operate their own output. The rest of this guide covers
that route. Its App Runner and SDK are unnecessary for the hosted builder route.

## Host your own

TickrMeter manages the device. Your integration reads the data, renders a small
image and publishes a feed. Your agent can build and deploy that integration,
but it does not need to stay running after setup. The background runtime does.

Build and preview reusable apps without choosing or owning a device. Delivery is
available to active accounts when **enabled by the operator**, with compatible firmware
and explicit `devices:control` consent. Read `get_capabilities` and
`list_delivery_devices` for the global switch and owned active devices; operator
pre-registration of device IDs is not required. The current
firmware retrieves public HTTPS feeds; protected source credentials are not
supported. Use synthetic or explicitly public data when testing this delivery path.

## The three hosting choices

| Choice | Good fit | What it needs | Ongoing tradeoff |
| --- | --- | --- | --- |
| Existing customer server | The company already has an approved web service, scheduler or cloud environment | Access to that runtime, a stable HTTPS endpoint, background scheduling and provider authorization | Reuses existing operations; still consumes resources and needs someone to maintain it |
| New customer-owned server/service | No existing host, or a display should keep updating when personal computers are off | A provider/account choice, approved budget, an approved deployment and operating owner | More reliable independence from a personal computer; provider charges and maintenance may apply |
| Customer's own computer | Local development, a personal prototype, or an always-on managed computer | Node.js or another renderer runtime, background startup, an awake/online machine, and an explicitly approved stable HTTPS gateway/tunnel for later external delivery | Can avoid a dedicated server subscription, but sleep, shutdown, updates and internet outages stop fresh data; the gateway may have its own cost |

Prefer the existing server when it is suitable and authorized. If the customer
does not have one, explain the new-service and own-computer choices; do not treat
the lack of a server as a dead end or silently create a paid account.

TickrMeter-managed execution of arbitrary customer code is deferred; the hosted
builder above is a different service. Do not offer a price or claim a runtime is
provisioned. The saved self-hosting choice
records the plan; selecting it does not create any infrastructure.

The own-computer option does not require opening router ports. A public gateway
or tunnel is an optional separate network service chosen and authorized by the
customer. Do not install one, expose another application, change a firewall or
open a router port as an implicit part of a preview. Its public hostname must
remain stable and satisfy the feed URL restrictions; a changing development URL
would require updating the TickrMeter configuration. A localhost address or LAN
address is useful for local preview but is not an accepted final feed URL.

## What the agent needs to establish

Ask only for facts that are missing from the customer's request or environment:

1. **Data access:** Which system owns the metric, which period/definition should
   be displayed, and how will the background service obtain ongoing read access?
2. **Existing runtime:** Is there an approved server or deployment environment
   available to this agent, and who owns its operation?
3. **If no host exists:** Would the customer prefer a new hosted service with an
   agreed cost or an own-computer setup whose availability depends on that machine?
4. **Confidentiality:** Is the intended content public, or must it remain private?
   Private content cannot be exposed on an unauthenticated feed while device-side
   source authentication remains unavailable.

An agent having access to email statistics in the current conversation does not
automatically give a deployed service long-lived permission to that email system.
Use the provider's supported OAuth/integration or a narrowly scoped read credential
approved for the runtime. Never reuse browser cookies, the agent's credentials,
the TickrMeter OAuth token or a personal login session as the data-source credential.
Keep secrets in customer-controlled secret storage, outside generated files,
feeds, image URLs and the TickrMeter platform.

## Use the maintained App Runner

For new apps, call `get_app_runner_bundle` and `get_sdk_bundle`. Write the verified
bundles to sibling `packages/tickrmeter-app-runner` and
`packages/tickrmeter-display-sdk` directories in the approved customer project.
Read the runner's README. Node.js22+ is required; no npm installation is needed.
Its `init ./my-app --template clock` or `--template metric` creates a small trusted
app module plus `runner.json`. Run `once ./my-app/runner.json` to render local files
and `doctor ./my-app/runner.json` to identify configuration/output blockers.
These are arguments to `node packages/tickrmeter-app-runner/bin/tickrmeter-app-runner.js`.

The runner supplies recurring jobs, reusable rendering, bounded retries, frame
retention and feed serving. The agent customizes data collection and LED/layout
choices. Multiple apps share one runner. Preserve the supplied runtime code and
version; keep customer logic in separate modules. A working existing corporate
service can use the SDK directly without migrating to the runner.

`start` is a foreground process until the customer installs it under their
approved service manager. Included Linux container templates prepare that step;
they do not create a server, HTTPS endpoint, provider connection or paid account.
`doctor` verifies local state only and must not be presented as proof of remote
hosting or physical delivery. Private previews remain local: HTTP output requires
public-content acknowledgement and a real feed origin. App modules execute as
trusted customer code and are not an untrusted marketplace sandbox.

An agent connected only to remote MCP may not have execution/deployment tools.
Check access first; a temporary agent sandbox is not a permanent server. Help
the customer continue in an environment with approved host access when necessary.

## Lower-level SDK sample

The SDK bundle contains a complete synthetic example. In the directory where its
files were written, run:

```sh
node examples/generate.js --out ./display-output --base-url https://display.example.com
```

This writes a synthetic 32.4% email open rate, a preview PNG, an immutable bitmap
and `feed.json`. It does not call an email provider or access a TickrMeter device.
Replace the example hostname with the approved final hostname when a runtime is
chosen. The host must serve the feed and bitmap from the same HTTPS origin.

For the public synthetic firmware test:

```sh
node examples/public-server.js ./display-output
```

This listener binds to `127.0.0.1:8080` and serves only `feed.json` and hash-named
frames without authentication. It does not expose the machine to the internet,
create TLS, deploy a proxy, or schedule rendering. Use the customer's approved
HTTPS reverse proxy or static hosting, then separately schedule the generator.
The generated example stays unchanged until generation runs again; preserve the
provider observation time when using cached real data.

Check the final external endpoint, not only this loopback listener:

- HTTP 200 without redirects, compression or chunked transfer; preserve exact
  `Content-Length` through the proxy/CDN.
- `application/json` feed of at most 2,048 bytes and a same-origin
  `application/octet-stream` frame of exactly 4,736 bytes with matching SHA-256.
- Public IPv4 DNS, a valid hostname/certificate/date, and a chain supported by
  the current firmware: ISRG Root X1, GTS Root R4, Amazon Root CA 1 or DigiCert
  Global Root G2. A successful desktop browser request is not device acceptance.
- Fresh `observedAt`, published frame before feed, and retained previous frames
  for in-flight requests. The device also needs working network time acquisition.

For a separate local customer-side authentication example, supply a random
32–128 character URL-safe secret as `DISPLAY_READ_TOKEN` through the environment:

```sh
node examples/server.js ./display-output
```

The server listens on `127.0.0.1:8080`, serves only the sample files, and expects
that source-read secret in an Authorization header. It does not log secrets or
install a gateway. A customer's approved HTTPS reverse proxy can route to it.
This proves the customer server's behavior, not that today's firmware can supply
that credential. Protected device delivery is still pending.

## Prepare the chosen runtime

For an **existing server**, use the customer's established deployment and secret
management process. Add a small scheduled task/service to collect and render data,
publish immutable frames, then atomically replace the feed. Verify HTTPS, process
supervision, the selected interval and failure reporting within that environment.
Do not assume permission to change a shared production service.

For a **new hosted service**, first agree the provider/account, expected operating
cost, data location and who maintains it. Reuse any approval the customer already
gave. Prepare the application and deployment settings for review before any
unapproved purchase or charge. There is no built-in TickrMeter hosting account
or vendor-specific automatic deployment in this preview.

For an **own-computer runtime**, run the same example and collection/rendering
process locally. An approved operating-system background service/scheduler must
start it after restart without keeping an agent chat or terminal open. Test sleep,
restart and network loss. Configure an approved stable HTTPS gateway only when
external delivery is required and privacy requirements are satisfied. Do not
disable sleep or change startup/security settings without the applicable customer
instruction. Explain that an e-ink image may remain visible after the machine
stops updating; visible data is not proof that it is fresh.

Each approach needs a reasonable polling schedule, error handling, source
observation timestamps, bounded storage retention and operational ownership.
Provider data collection and rendering run in customer code, not in recurring
LLM prompts. Rendering a cached value must not reset its freshness timestamp.
The customer service evaluates the LED condition and publishes its resulting
color; TickrMeter's Off/fixed/source preferences remain authoritative.

## Finish with an accurate status

Hand over a short report that the customer can understand and their next agent
can continue. The structured checklist is also available in `get_hosting_options`.
Selecting hosting, preparing files and saving a preview are separate from
running a service. Do not mark one complete because another succeeded.

| Check | Evidence to report |
| --- | --- |
| Provider access | Provider, metric/reporting period, authorization method and an actual authorized read from the background runtime. Identify secret storage by mechanism only; never include its values. |
| Background runtime | Actual customer host, service/scheduler, selected interval and operating owner. Verify a scheduled run independently of the agent conversation, and startup after an approved restart. |
| Failure and freshness | In an authorized test environment, check network/provider failure and recovery. Preserve last-good output and its observation time; confirm bounded retries and stored frames. Test restart and describe sleep/offline limits for a computer. |
| Customer endpoint | Which HTTPS/feed/frame checks actually ran, from where and when. Check the immutable frame checksum and publish frame before feed. Do not make a private feed public to pass a check. |
| Account preview | Saved app ID/version and local-payload result, if an upload was authorized. Uploading a preview stores the bitmap and feed metadata on TickrMeter. Use a synthetic preview, or keep it local when data must remain entirely on customer infrastructure. |
| Device delivery | Check live capability, scope and device eligibility first. `assign_app` requests a versioned app snapshot; `get_delivery` reports backend desired state and request/publication status. Broker acceptance does not confirm firmware receipt, feed retrieval or visible output. Report physical screen and LED evidence separately, or mark it unverified. Protected feeds remain blocked. |

For each row use **prepared**, **verified**, **failed**, **unverified**,
**blocked**, or **not applicable**, followed by the evidence and next action or
operating owner. “Verified” means that specific check ran successfully; it is not
a general hosting or security certification. If a restart or failure simulation
would disrupt a service and has not been authorized, mark it unverified instead
of performing it. Never include credentials or private payloads in the report.

Finish with the exact next step. For example: “The synthetic preview is saved.
The collection service still needs your email provider's authorization and a
scheduled run on your server. Delivery is currently disabled by the global
switch.” Or: “The delivery request was accepted; the physical screen and LED are
still unverified.” Read `get_delivery` before retrying an uncertain response,
use `retry_delivery` for the same revision and `restore_display` when the customer
wants to return to the prior TickrMeter display. Do not call a prepared endpoint
or a broker-accepted request a working physical integration without evidence.
