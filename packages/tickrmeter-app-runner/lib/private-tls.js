'use strict';

const { createSecureContext } = require('node:tls');
const { X509Certificate } = require('node:crypto');
const { isIP } = require('node:net');
const { fail } = require('./config');
const { readPrivateFile } = require('./private-files');
function loadPrivateTls(config) {
  try {
    const cert = readPrivateFile(config.tls.certificateFile, 65536, false);
    const key = readPrivateFile(config.tls.keyFile, 32768);
    const certificate = new X509Certificate(cert);
    const host = new URL(config.publicBaseUrl).hostname;
    if (!(isIP(host) ? certificate.checkIP(host) : certificate.checkHost(host)) ||
        Date.parse(certificate.validFrom) > Date.now() || Date.parse(certificate.validTo) <= Date.now()) fail('INVALID_PRIVATE_TLS');
    const options = { cert, key, minVersion: 'TLSv1.2' };
    createSecureContext(options); // Checks that the key matches the certificate without opening a listener.
    return options;
  } catch { fail('INVALID_PRIVATE_TLS'); }
}
module.exports = { loadPrivateTls };
