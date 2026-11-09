// Packs trips into a compact, compressed string for share links, and back.
// Layout: [version u8][homeId u32][count u16] then per visit [cityId u32][year-1900 u8][month u8]

const VERSION = 1;

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

export async function encodeShare(data) {
  const visits = data.visits.slice(0, 65535);
  const buf = new DataView(new ArrayBuffer(7 + visits.length * 6));
  buf.setUint8(0, VERSION);
  buf.setUint32(1, data.home || 0);
  buf.setUint16(5, visits.length);
  visits.forEach((v, i) => {
    const o = 7 + i * 6;
    buf.setUint32(o, v.cityId);
    buf.setUint8(o + 4, Math.max(0, Math.min(255, v.y - 1900)));
    buf.setUint8(o + 5, v.m || 0);
  });
  const raw = new Uint8Array(buf.buffer);
  if (canCompress) return 'z' + toBase64Url(await pipe(raw, new CompressionStream('deflate-raw')));
  return 'r' + toBase64Url(raw);
}

export async function decodeShare(str) {
  const kind = str[0];
  let bytes = fromBase64Url(str.slice(1));
  if (kind === 'z') bytes = await pipe(bytes, new DecompressionStream('deflate-raw'));
  else if (kind !== 'r') throw new Error('Unknown share format');
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (dv.getUint8(0) !== VERSION) throw new Error('Unsupported share version');
  const home = dv.getUint32(1) || null;
  const count = dv.getUint16(5);
  const visits = [];
  for (let i = 0; i < count; i++) {
    const o = 7 + i * 6;
    visits.push({ id: 's' + i, cityId: dv.getUint32(o), y: 1900 + dv.getUint8(o + 4), m: dv.getUint8(o + 5) });
  }
  return { home, visits };
}
