// Read-only access to a named Windows shared-memory section (the mechanism
// both ACC and AMS2 use to publish telemetry), through koffi.
import koffi from 'koffi';

const FILE_MAP_READ = 0x0004;

// Win32 BOOL is a 4-byte int, not a 1-byte C/C++ bool — using koffi's 'bool'
// here misaligns the native call and crashes the process (N-API fatal error).
const kernel32 = koffi.load('kernel32.dll');
const OpenFileMappingW = kernel32.func(
  '__stdcall',
  'OpenFileMappingW',
  'void *',
  ['uint32', 'int32', 'wchar_t *'],
);
const MapViewOfFile = kernel32.func('__stdcall', 'MapViewOfFile', 'void *', [
  'void *',
  'uint32',
  'uint32',
  'uint32',
  'size_t',
]);
const UnmapViewOfFile = kernel32.func('__stdcall', 'UnmapViewOfFile', 'int32', [
  'void *',
]);
const CloseHandle = kernel32.func('__stdcall', 'CloseHandle', 'int32', [
  'void *',
]);

export class SharedSection {
  constructor(name, size) {
    this.name = name;
    this.size = size;
    this.handle = null;
    this.view = null;
  }

  tryOpen() {
    if (this.view) return true;
    const handle = OpenFileMappingW(FILE_MAP_READ, 0, this.name);
    if (!handle) return false;
    // Pass 0 to map the entire file — requesting an explicit size larger than
    // what ACC created causes MapViewOfFile to return NULL on Windows, which
    // was silently preventing the graphics section from ever opening.
    const view = MapViewOfFile(handle, FILE_MAP_READ, 0, 0, 0);
    if (!view) {
      CloseHandle(handle);
      return false;
    }
    this.handle = handle;
    this.view = view;
    return true;
  }

  // koffi.view() creates an external ArrayBuffer, which Electron's V8 build
  // forbids (crashes the process). koffi.decode() copies bytes instead, so
  // it's the Electron-safe way to read raw memory through koffi.
  read(size = this.size) {
    const bytes = koffi.decode(this.view, 'uint8_t', size);
    return Buffer.from(bytes);
  }

  // Copies `size` bytes starting at `offset` — for big sections (LMU's is
  // ~320 KB) where only a few slices are needed each tick.
  readAt(offset, size) {
    const bytes = koffi.decode(this.view, offset, 'uint8_t', size);
    return Buffer.from(bytes);
  }

  close() {
    if (this.view) UnmapViewOfFile(this.view);
    if (this.handle) CloseHandle(this.handle);
    this.view = null;
    this.handle = null;
  }
}
