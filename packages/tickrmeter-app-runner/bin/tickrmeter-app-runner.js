#!/usr/bin/env node
'use strict';

const { loadConfig, createRunner, readStatus, doctor, initProject, RunnerError, changeCredential, credentialSummary } = require('..');
const HELP = 'Usage: tickrmeter-app-runner init <directory> [--template clock|metric]\n       tickrmeter-app-runner once|start|status|doctor <runner.json>\n' +
  '       tickrmeter-app-runner credential-add <runner.json> <id> <app-id> <device-label> --token-file <new-private-file>\n' +
  '       tickrmeter-app-runner credential-rotate <runner.json> <id> --token-file <new-private-file>\n' +
  '       tickrmeter-app-runner credential-revoke <runner.json> <id>\n' +
  '       tickrmeter-app-runner credential-list <runner.json>\n';
const SAFE_CODES = new Set(['UNKNOWN_TEMPLATE', 'INVALID_PROJECT_DIRECTORY', 'PROJECT_NOT_EMPTY', 'INVALID_CONFIG', 'INVALID_FILE',
  'INVALID_PUBLIC_ORIGIN', 'INVALID_PORT', 'INVALID_OUTPUT_DIRECTORY', 'INVALID_APPS', 'INVALID_APP_ID', 'INVALID_APP_MODULE',
  'INVALID_APP_TIMING', 'INVALID_SECRET_MAPPING', 'CONFIG_UNREADABLE_OR_INVALID', 'OUTPUT_LOCKED', 'APP_MODULE_LOAD_FAILED',
  'LISTENER_START_FAILED', 'RUNNER_ALREADY_STARTED_OR_STOPPED', 'INVALID_PRIVATE_CONFIG', 'INVALID_PRIVATE_ORIGIN',
  'INVALID_PRIVATE_BIND', 'INVALID_PRIVATE_FILE', 'PRIVATE_FILE_PERMISSIONS', 'INVALID_PRIVATE_TLS', 'PRIVATE_CONFIG_REQUIRED',
  'INVALID_CREDENTIAL_STORE', 'CREDENTIAL_STORE_LOCKED', 'INVALID_CREDENTIAL_ARGUMENTS', 'UNKNOWN_CREDENTIAL', 'INVALID_TOKEN_FILE',
  'PRIVATE_OUTPUT_REQUIRES_PRIVATE_CONFIG', 'PRIVATE_OUTPUT_NOT_INITIALIZED', 'INVALID_PRIVATE_OUTPUT']);
async function main(args) {
  const [command, target, option, template] = args;
  if (args.length === 1 && ['help', '--help', '-h'].includes(command)) { process.stdout.write(HELP); return; }
  if (Number(process.versions.node.split('.')[0]) < 22) throw new Error('UNSUPPORTED_NODE');
  if (command === 'init' && target && (args.length === 2 || (args.length === 4 && option === '--template'))) {
    process.stdout.write(`${JSON.stringify(initProject(target, template || 'clock'), null, 2)}\n`); return;
  }
  if (command === 'credential-list' && args.length === 2) {
    process.stdout.write(`${JSON.stringify({ credentials: credentialSummary(loadConfig(target)) }, null, 2)}\n`); return;
  }
  if ((command === 'credential-add' && args.length === 7 && args[5] === '--token-file') ||
      (command === 'credential-rotate' && args.length === 5 && args[3] === '--token-file') ||
      (command === 'credential-revoke' && args.length === 3)) {
    const operation = command.slice('credential-'.length);
    const options = { id: args[2], ...(operation === 'add' ? { appId: args[3], deviceId: args[4], tokenFile: args[6] }
      : operation === 'rotate' ? { tokenFile: args[4] } : {}) };
    process.stdout.write(`${JSON.stringify(changeCredential(loadConfig(target), operation, options), null, 2)}\n`); return;
  }
  if (args.length !== 2 || !['once', 'start', 'status', 'doctor'].includes(command)) { process.stderr.write(HELP); process.exitCode = 1; return; }
  const config = loadConfig(target);
  if (command === 'status') { process.stdout.write(`${JSON.stringify(readStatus(config), null, 2)}\n`); return; }
  if (command === 'doctor') {
    const result = doctor(config);
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    if (!(result.configuredForPublicDelivery || result.privateHostPrepared)) process.exitCode = 1;
    return;
  }
  const runner = await createRunner(config);
  if (command === 'once') {
    let pending = 0;
    try {
      const result = await runner.once();
      process.stdout.write(`${JSON.stringify({ ...(config.mode === 'private' ? { version: 2, deviceDeliverySupported: false } : { version: 1 }), apps: result }, null, 2)}\n`);
      if (result.some(app => app.error)) process.exitCode = 1;
    } finally { pending = (await runner.stop()).pendingCollectors; }
    // A trusted collector may ignore AbortSignal. End this one-shot process;
    // never launch overlapping work. The next invocation reclaims its stale lock.
    if (pending) process.exit(process.exitCode || 1);
    return;
  }
  try { await runner.start(); } catch (error) { await runner.stop(); throw error; }
  process.stdout.write(`${JSON.stringify({ event: 'started', port: config.port, publicDelivery: runner.status().publicDelivery,
    ...(config.mode === 'private' ? { privateHostConfigured: true, deviceDeliverySupported: false } : {}),
    message: config.mode === 'private' ? 'Protected HTTPS host started. Current firmware cannot retrieve private feeds; device delivery is not supported.'
      : runner.status().publicDelivery ? 'Loopback listener ready for an approved HTTPS proxy; public reachability is unverified.' : 'Local preview mode. HTTP delivery is disabled.' })}\n`);
  let stopping = false;
  const stop = async () => {
    if (stopping) return;
    stopping = true;
    const deadline = setTimeout(() => process.exit(0), 5000);
    deadline.unref();
    await runner.stop();
  };
  process.once('SIGINT', stop); process.once('SIGTERM', stop);
}
if (require.main === module) main(process.argv.slice(2)).catch(error => {
  const code = error instanceof RunnerError && SAFE_CODES.has(error.code) ? error.code : 'RUNNER_FAILED';
  process.stderr.write(`${code}. Check the local configuration and installed runtime. Provider errors and secrets are not printed.\n`);
  process.exitCode = 1;
});
module.exports = { main };
