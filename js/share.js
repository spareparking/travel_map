// Packs trips into a compact, compressed string for share links, and back.
// v2 layout: [version u8 = 2][homeCount u8] per home [cityId u32][from u8][to u8]
//            [visitCount u16] per visit [cityId u32][year-1900 u8][month u8]
// Years are stored as year-1900; 0 means "unknown" for `from` and "now" for `to`.
// v1 (older links): [version u8 = 1][homeId u32][visitCount u16] then visits as above.

const VERSION = 2;

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

export async function encodeShare(data) {
  const homes = data.homes.slice(0, 255);
  const visits = data.visits.slice(0, 65535);
  const size = 2 + homes.length * 6 + 2 + visits.length * 6;
  const dv = new DataView(new ArrayBuffer(size));
  let o = 0;
  dv.setUint8(o++, VERSION);
  dv.setUint8(o++, homes.length);
  for (const h of homes) {
    dv.setUint32(o, h.cityId); dv.setUint8(o + 4, yearByte(h.from)); dv.setUint8(o + 5, yearByte(h.to)); o += 6;
  }
  dv.setUint16(o, visits.length); o += 2;
  for (const v of visits) {
    dv.setUint32(o, v.cityId); dv.setUint8(o + 4, Math.max(0, Math.min(255, v.y - 1900))); dv.setUint8(o + 5, v.m || 0); o += 6;
  }
  const raw = new Uint8Array(dv.buffer);
  if (canCompress) return 'z' + toBase64Url(await pipe(raw, new CompressionStream('deflate-raw')));
  return 'r' + toBase64Url(raw);
}

export async function decodeShare(str) {
  const kind = str[0];
  let bytes = fromBase64Url(str.slice(1));
  if (kind === 'z') bytes = await pipe(bytes, new DecompressionStream('deflate-raw'));
  else if (kind !== 'r') throw new Error('Unknown share format');
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const version = dv.getUint8(0);
  const homes = [];
  let o;
  if (version === 1) {
    const id = dv.getUint32(1);
    if (id) homes.push({ id: 'h0', cityId: id, from: null, to: null });
    o = 5;
  } else if (version === 2) {
    const n = dv.getUint8(1);
    o = 2;
    for (let i = 0; i < n; i++, o += 6) {
      homes.push({ id: 'h' + i, cityId: dv.getUint32(o), from: byteYear(dv.getUint8(o + 4)), to: byteYear(dv.getUint8(o + 5)) });
    }
  } else {
    throw new Error('Unsupported share version');
  }
  const count = dv.getUint16(o); o += 2;
  const visits = [];
  for (let i = 0; i < count; i++, o += 6) {
    visits.push({ id: 's' + i, cityId: dv.getUint32(o), y: 1900 + dv.getUint8(o + 4), m: dv.getUint8(o + 5) });
  }
  return { homes, visits };
}
