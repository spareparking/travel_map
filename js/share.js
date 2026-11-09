// Packs trips into a compact, compressed string for share links, and back.
//
// v3 layout (current):
//   [version u8 = 3]
//   [homeCount u8]   per home  [cityId u32][from u8][to u8]
//   [placeCount u16] per place [id u32][lat i32 ×1e5][lon i32 ×1e5][cc 2 ascii][nameLen u8][name utf8][adminLen u8][admin utf8]
//   [visitCount u16] per visit [cityId u32][year-1900 u8][month u8]
// Home years are stored as year-1900; 0 means "unknown" for `from` and "now" for `to`.
// "Places" are ones added from the online search, which aren't in the built-in city list.
// v2 = v3 without the places section. v1 = [1][homeId u32][visitCount u16][visits].

const VERSION = 3;

function toBase64Url(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(str) {
  const b64 = str.replace(/-/g, '+').replace(/_/g, '/');
  const s = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

async function pipe(bytes, stream) {
  const res = new Response(new Blob([bytes]).stream().pipeThrough(stream));
  return new Uint8Array(await res.arrayBuffer());
}

const canCompress = typeof CompressionStream !== 'undefined';
const yearByte = (y) => (y == null ? 0 : Math.max(1, Math.min(255, y - 1900)));
const byteYear = (b) => (b === 0 ? null : 1900 + b);

class Writer {
  constructor() { this.buf = new Uint8Array(256); this.dv = new DataView(this.buf.buffer); this.o = 0; }
  ensure(n) {
    if (this.o + n <= this.buf.length) return;
    const next = new Uint8Array(Math.max(this.buf.length * 2, this.o + n));
    next.set(this.buf);
    this.buf = next; this.dv = new DataView(next.buffer);
  }
  u8(v) { this.ensure(1); this.dv.setUint8(this.o, v); this.o += 1; }
  u16(v) { this.ensure(2); this.dv.setUint16(this.o, v); this.o += 2; }
  u32(v) { this.ensure(4); this.dv.setUint32(this.o, v); this.o += 4; }
  i32(v) { this.ensure(4); this.dv.setInt32(this.o, v); this.o += 4; }
  str(s) {
    let b = new TextEncoder().encode(s || '');
    if (b.length > 255) b = b.slice(0, 255);
    this.u8(b.length); this.ensure(b.length); this.buf.set(b, this.o); this.o += b.length;
  }
  bytes() { return this.buf.slice(0, this.o); }
}

class Reader {
  constructor(bytes) { this.b = bytes; this.dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength); this.o = 0; }
  u8() { return this.dv.getUint8(this.o++); }
  u16() { const v = this.dv.getUint16(this.o); this.o += 2; return v; }
  u32() { const v = this.dv.getUint32(this.o); this.o += 4; return v; }
  i32() { const v = this.dv.getInt32(this.o); this.o += 4; return v; }
  str() { const n = this.u8(); const s = new TextDecoder().decode(this.b.subarray(this.o, this.o + n)); this.o += n; return s; }
}

/** data: {homes, visits}; places: online-added places referenced by them. */
export async function encodeShare(data, places = []) {
  const homes = data.homes.slice(0, 255);
  const visits = data.visits.slice(0, 65535);
  const w = new Writer();
  w.u8(VERSION);
  w.u8(homes.length);
  for (const h of homes) { w.u32(h.cityId); w.u8(yearByte(h.from)); w.u8(yearByte(h.to)); }
  w.u16(places.length);
  for (const p of places) {
    w.u32(p.id); w.i32(Math.round(p.lat * 1e5)); w.i32(Math.round(p.lon * 1e5));
    w.u8(p.cc.charCodeAt(0) || 0); w.u8(p.cc.charCodeAt(1) || 0);
    w.str(p.name); w.str(p.admin);
  }
  w.u16(visits.length);
  for (const v of visits) { w.u32(v.cityId); w.u8(Math.max(0, Math.min(255, v.y - 1900))); w.u8(v.m || 0); }
  const raw = w.bytes();
  if (canCompress) return 'z' + toBase64Url(await pipe(raw, new CompressionStream('deflate-raw')));
  return 'r' + toBase64Url(raw);
}

export async function decodeShare(str) {
  const kind = str[0];
  let bytes = fromBase64Url(str.slice(1));
  if (kind === 'z') bytes = await pipe(bytes, new DecompressionStream('deflate-raw'));
  else if (kind !== 'r') throw new Error('Unknown share format');
  const r = new Reader(bytes);
  const version = r.u8();
  if (version < 1 || version > 3) throw new Error('Unsupported share version');
  const homes = [];
  const places = [];
  if (version === 1) {
    const id = r.u32();
    if (id) homes.push({ id: 'h0', cityId: id, from: null, to: null });
  } else {
    const n = r.u8();
    for (let i = 0; i < n; i++) homes.push({ id: 'h' + i, cityId: r.u32(), from: byteYear(r.u8()), to: byteYear(r.u8()) });
  }
  if (version >= 3) {
    const n = r.u16();
    for (let i = 0; i < n; i++) {
      const id = r.u32(), lat = r.i32() / 1e5, lon = r.i32() / 1e5;
      const cc = String.fromCharCode(r.u8(), r.u8());
      places.push({ id, lat, lon, cc, name: r.str(), admin: r.str() });
    }
  }
  const count = r.u16();
  const visits = [];
  for (let i = 0; i < count; i++) visits.push({ id: 's' + i, cityId: r.u32(), y: 1900 + r.u8(), m: r.u8() });
  return { homes, visits, places };
}
