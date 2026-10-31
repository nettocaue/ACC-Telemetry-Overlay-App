// Generates a self-signed X.509 certificate with nothing but node:crypto.
//
// The phone page needs HTTPS: Chrome only exposes motion sensors, wake lock
// and fullscreen-orientation lock to secure contexts, and those are what the
// phone controller builds on. There's no CA that will sign a certificate
// for a LAN IP, so we self-sign one once, persist it, and the user accepts
// Chrome's warning a single time per device.
//
// Node can create key pairs and signatures but not certificates, so this
// builds the (small, fixed-shape) DER structure by hand: EC P-256 key,
// ecdsa-with-SHA256 signature, subjectAltName with localhost + LAN IPs.
import crypto from 'node:crypto';
import net from 'node:net';

function derLength(len) {
  if (len < 0x80) return Buffer.from([len]);
  const bytes = [];
  while (len > 0) {
    bytes.unshift(len & 0xff);
    len >>= 8;
  }
  return Buffer.from([0x80 | bytes.length, ...bytes]);
}

function tlv(tag, content) {
  return Buffer.concat([Buffer.from([tag]), derLength(content.length), content]);
}

const seq = (...items) => tlv(0x30, Buffer.concat(items));
const set = (...items) => tlv(0x31, Buffer.concat(items));
const octetString = (buf) => tlv(0x04, buf);
const utf8String = (str) => tlv(0x0c, Buffer.from(str, 'utf8'));
const bitString = (buf) => tlv(0x03, Buffer.concat([Buffer.from([0]), buf]));
const explicit = (n, content) => tlv(0xa0 | n, content);

function integer(buf) {
  let b = Buffer.from(buf);
  while (b.length > 1 && b[0] === 0 && (b[1] & 0x80) === 0) b = b.subarray(1);
  if (b[0] & 0x80) b = Buffer.concat([Buffer.from([0]), b]);
  return tlv(0x02, b);
}

function oid(str) {
  const parts = str.split('.').map(Number);
  const bytes = [40 * parts[0] + parts[1]];
  for (const part of parts.slice(2)) {
    const chunk = [part & 0x7f];
    let v = part >>> 7;
    while (v > 0) {
      chunk.unshift((v & 0x7f) | 0x80);
      v >>>= 7;
    }
    bytes.push(...chunk);
  }
  return tlv(0x06, Buffer.from(bytes));
}

function utcTime(date) {
  // YYMMDDHHMMSSZ — valid for years up to 2049, which is plenty here.
  const p = (n) => String(n).padStart(2, '0');
  const s =
    p(date.getUTCFullYear() % 100) +
    p(date.getUTCMonth() + 1) +
    p(date.getUTCDate()) +
    p(date.getUTCHours()) +
    p(date.getUTCMinutes()) +
    p(date.getUTCSeconds()) +
    'Z';
  return tlv(0x17, Buffer.from(s, 'ascii'));
}

function ipBytes(ip) {
  if (net.isIPv4(ip)) return Buffer.from(ip.split('.').map(Number));
  return null; // IPv6 SANs aren't worth the parsing code for a LAN app
}

function toPem(label, der) {
  const b64 = der.toString('base64').match(/.{1,64}/g).join('\n');
  return `-----BEGIN ${label}-----\n${b64}\n-----END ${label}-----\n`;
}

export function generateSelfSignedCert({
  commonName = 'ACC Telemetry App',
  ips = [],
  years = 10,
} = {}) {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', {
    namedCurve: 'prime256v1',
  });

  const ecdsaWithSha256 = seq(oid('1.2.840.10045.4.3.2'));
  const name = seq(set(seq(oid('2.5.4.3'), utf8String(commonName))));

  const serial = crypto.randomBytes(16);
  serial[0] &= 0x7f;
  serial[0] |= 0x01; // keep it positive and non-zero

  const notBefore = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const notAfter = new Date(notBefore);
  notAfter.setUTCFullYear(notAfter.getUTCFullYear() + years);

  const altNames = [tlv(0x82, Buffer.from('localhost', 'ascii'))];
  for (const ip of ['127.0.0.1', ...ips]) {
    const bytes = ipBytes(ip);
    if (bytes) altNames.push(tlv(0x87, bytes));
  }

  const extensions = seq(
    seq(oid('2.5.29.17'), octetString(seq(...altNames))), // subjectAltName
    seq(oid('2.5.29.19'), octetString(seq())), // basicConstraints: not a CA
  );

  const tbsCertificate = seq(
    explicit(0, integer(Buffer.from([2]))), // v3
    integer(serial),
    ecdsaWithSha256,
    name, // issuer
    seq(utcTime(notBefore), utcTime(notAfter)),
    name, // subject (self-signed)
    publicKey.export({ type: 'spki', format: 'der' }),
    explicit(3, extensions),
  );

  const signature = crypto.sign('sha256', tbsCertificate, privateKey);
  const certificate = seq(tbsCertificate, ecdsaWithSha256, bitString(signature));

  return {
    cert: toPem('CERTIFICATE', certificate),
    key: privateKey.export({ type: 'pkcs8', format: 'pem' }),
  };
}
