'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { randomBytes } = require('node:crypto');

function writeAtomic(filename, data) {
  const destination = path.resolve(filename);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  const temporary = `${destination}.${randomBytes(12).toString('hex')}.tmp`;
  try {
    fs.writeFileSync(temporary, data, { flag: 'wx', mode: 0o600 });
    fs.renameSync(temporary, destination);
  } finally {
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
  }
}

function parseArgs(args, allowed) {
  const options = {};
  const positional = [];
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (!arg.startsWith('--')) { positional.push(arg); continue; }
    if (!allowed.includes(arg) || Object.hasOwn(options, arg) || !args[index + 1] || args[index + 1].startsWith('--')) throw new Error('Invalid command options.');
    options[arg] = args[++index];
  }
  return { options, positional };
}

module.exports = { writeAtomic, parseArgs };
