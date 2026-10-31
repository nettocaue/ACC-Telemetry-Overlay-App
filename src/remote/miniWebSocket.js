// Minimal RFC 6455 WebSocket server side — just what the phone link needs:
// small text messages both ways, ping/pong keepalive, clean close. Kept
// dependency-free on purpose: the packaged app only ships koffi from
// node_modules (see forge.config.mjs), and this is ~150 lines.
import crypto from 'node:crypto';
import { EventEmitter } from 'node:events';

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const MAX_MESSAGE_BYTES = 64 * 1024;
// A phone on bad Wi-Fi can't keep up with 30 telemetry frames a second; past
// this much unsent data we skip frames instead of queueing stale ones.
const MAX_BUFFERED_BYTES = 256 * 1024;

const OP = { CONT: 0x0, TEXT: 0x1, BIN: 0x2, CLOSE: 0x8, PING: 0x9, PONG: 0xa };

function encodeFrame(opcode, payload) {
  const len = payload.length;
  let header;
  if (len < 126) {
    header = Buffer.from([0x80 | opcode, len]);
  } else if (len < 65536) {
    header = Buffer.alloc(4);
    header[0] = 0x80 | opcode;
    header[1] = 126;
    header.writeUInt16BE(len, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x80 | opcode;
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(len), 2);
  }
  return Buffer.concat([header, payload]);
}

export class WsConnection extends EventEmitter {
  constructor(socket) {
    super();
    this.socket = socket;
    this.buffer = Buffer.alloc(0);
    this.fragments = [];
    this.closed = false;
    this.lastSeenAt = Date.now();

    socket.setNoDelay(true);
    socket.on('data', (chunk) => this._onData(chunk));
    socket.on('close', () => this._finish());
    socket.on('error', () => this._finish());
  }

  send(text) {
    if (this.closed) return false;
    if (this.socket.writableLength > MAX_BUFFERED_BYTES) return false;
    this.socket.write(encodeFrame(OP.TEXT, Buffer.from(text, 'utf8')));
    return true;
  }

  ping() {
    if (!this.closed) this.socket.write(encodeFrame(OP.PING, Buffer.alloc(0)));
  }

  close(code = 1000) {
    if (this.closed) return;
    const payload = Buffer.alloc(2);
    payload.writeUInt16BE(code, 0);
    this.socket.end(encodeFrame(OP.CLOSE, payload));
    this._finish();
  }

  terminate() {
    this.socket.destroy();
    this._finish();
  }

  _finish() {
    if (this.closed) return;
    this.closed = true;
    this.emit('close');
  }

  _onData(chunk) {
    this.lastSeenAt = Date.now();
    this.buffer = Buffer.concat([this.buffer, chunk]);

    while (this.buffer.length >= 2) {
      const b0 = this.buffer[0];
      const b1 = this.buffer[1];
      const fin = (b0 & 0x80) !== 0;
      const opcode = b0 & 0x0f;
      const masked = (b1 & 0x80) !== 0;
      let len = b1 & 0x7f;
      let offset = 2;

      if (len === 126) {
        if (this.buffer.length < 4) return;
        len = this.buffer.readUInt16BE(2);
        offset = 4;
      } else if (len === 127) {
        if (this.buffer.length < 10) return;
        const big = this.buffer.readBigUInt64BE(2);
        if (big > BigInt(MAX_MESSAGE_BYTES)) return this.close(1009);
        len = Number(big);
        offset = 10;
      }
      // Clients must mask every frame (RFC 6455 §5.1).
      if (!masked) return this.close(1002);
      if (len > MAX_MESSAGE_BYTES) return this.close(1009);
      if (this.buffer.length < offset + 4 + len) return;

      const mask = this.buffer.subarray(offset, offset + 4);
      const payload = Buffer.from(
        this.buffer.subarray(offset + 4, offset + 4 + len),
      );
      for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i & 3];
      this.buffer = this.buffer.subarray(offset + 4 + len);

      this._onFrame(fin, opcode, payload);
      if (this.closed) return;
    }
  }

  _onFrame(fin, opcode, payload) {
    switch (opcode) {
      case OP.TEXT:
      case OP.BIN:
      case OP.CONT: {
        this.fragments.push(payload);
        if (!fin) return;
        const message = Buffer.concat(this.fragments);
        this.fragments = [];
        if (message.length > MAX_MESSAGE_BYTES) return this.close(1009);
        this.emit('message', message.toString('utf8'));
        return;
      }
      case OP.PING:
        this.socket.write(encodeFrame(OP.PONG, payload));
        return;
      case OP.PONG:
        return; // lastSeenAt was already refreshed in _onData
      case OP.CLOSE:
        this.close();
        return;
      default:
        this.close(1002);
    }
  }
}

// Completes the HTTP Upgrade handshake on a raw socket. Returns a
// WsConnection, or null after rejecting the request.
export function acceptUpgrade(req, socket) {
  const key = req.headers['sec-websocket-key'];
  const isWebSocket =
    (req.headers.upgrade ?? '').toLowerCase() === 'websocket' &&
    req.headers['sec-websocket-version'] === '13' &&
    typeof key === 'string';
  if (!isWebSocket) {
    socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n');
    return null;
  }
  const accept = crypto
    .createHash('sha1')
    .update(key + GUID)
    .digest('base64');
  socket.write(
    'HTTP/1.1 101 Switching Protocols\r\n' +
      'Upgrade: websocket\r\n' +
      'Connection: Upgrade\r\n' +
      `Sec-WebSocket-Accept: ${accept}\r\n\r\n`,
  );
  return new WsConnection(socket);
}
