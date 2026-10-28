'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { fail } = require('./config');
let windowsSid;
function ownerSid() {
  if (!windowsSid) {
    windowsSid = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
      '[System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value'], { encoding: 'utf8', windowsHide: true, timeout: 10000 }).trim();
    if (!/^S-1-5-(?:\d+-)*\d+$/.test(windowsSid)) fail('PRIVATE_FILE_PERMISSIONS');
  }
  return windowsSid;
}
function protectNewFile(filename) {
  if (process.platform !== 'win32') { fs.chmodSync(filename, fs.statSync(filename).isDirectory() ? 0o700 : 0o600); return; }
  try {
    // No shell interpolation and no credentials in process arguments. Only a newly created path is changed.
    const access = fs.statSync(filename).isDirectory() ? '(OI)(CI)(F)' : '(F)';
    execFileSync('icacls.exe', [filename, '/inheritance:r', '/grant:r', `*${ownerSid()}:${access}`, `*S-1-5-18:${access}`, `*S-1-5-32-544:${access}`],
      { stdio: 'ignore', windowsHide: true, timeout: 10000 });
  } catch { fail('PRIVATE_FILE_PERMISSIONS'); }
}
function assertProtected(filename, directory = false) {
  try {
    const stat = fs.lstatSync(filename);
    if (stat.isSymbolicLink() || (directory ? !stat.isDirectory() : !stat.isFile())) fail('PRIVATE_FILE_PERMISSIONS');
    if (process.platform !== 'win32') {
      if ((stat.mode & 0o077) !== 0 || (process.getuid && stat.uid !== process.getuid())) fail('PRIVATE_FILE_PERMISSIONS');
    } else {
      // Encoded path is data, not executable PowerShell. Reject every additional allow principal.
      const encodedPath = Buffer.from(path.resolve(filename), 'utf8').toString('base64');
      const script = `$ErrorActionPreference='Stop'; $p=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${encodedPath}')); ` +
        `$acl=[IO.${directory ? 'Directory' : 'File'}]::GetAccessControl($p); $allowed=@('${ownerSid()}','S-1-5-18','S-1-5-32-544'); ` +
        `foreach($rule in $acl.GetAccessRules($true,$true,[System.Security.Principal.SecurityIdentifier])){if($rule.AccessControlType -eq 'Allow' -and $rule.IdentityReference.Value -notin $allowed){exit 1}}; ` +
        `if($acl.GetOwner([System.Security.Principal.SecurityIdentifier]).Value -notin $allowed){exit 1}`;
      execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { stdio: 'ignore', windowsHide: true, timeout: 10000 });
    }
    return stat;
  } catch { fail('PRIVATE_FILE_PERMISSIONS'); }
}
function ensureProtectedDirectory(directory) {
  if (!fs.existsSync(directory)) {
    fs.mkdirSync(directory, { mode: 0o700 });
    protectNewFile(directory);
  }
  assertProtected(directory, true);
}
function readPrivateFile(filename, maxBytes, checkPermissions = true) {
  if (checkPermissions) assertProtected(filename);
  const stat = fs.lstatSync(filename);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size < 1 || stat.size > maxBytes) fail('INVALID_PRIVATE_FILE');
  const fd = fs.openSync(filename, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
  try {
    const opened = fs.fstatSync(fd);
    if (!opened.isFile() || opened.size !== stat.size || opened.ino !== stat.ino) fail('INVALID_PRIVATE_FILE');
    const data = Buffer.alloc(stat.size);
    let offset = 0;
    while (offset < data.length) {
      const count = fs.readSync(fd, data, offset, data.length - offset, offset);
      if (!count) fail('INVALID_PRIVATE_FILE');
      offset += count;
    }
    return data;
  } finally { fs.closeSync(fd); }
}

module.exports = { protectNewFile, assertProtected, ensureProtectedDirectory, readPrivateFile };
