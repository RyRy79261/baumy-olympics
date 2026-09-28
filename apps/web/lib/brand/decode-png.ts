import { crc32, inflateSync } from "node:zlib";

// Reads back the PNGs badge-png.ts writes (8-bit RGBA, every row filter 0),
// checking the signature and every chunk's CRC, so the tests look at the
// pixels a browser would see rather than trusting the encoder. Anything else
// is refused, which is how a PNG from another tool shows up.

export function decodePng(png: Uint8Array): { size: number; rgba: Uint8Array } {
  const buf = Buffer.from(png);
  if (
    !buf.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  ) {
    throw new Error("not a PNG");
  }
  let at = 8;
  let width = 0;
  let height = 0;
  const idat: Buffer[] = [];
  while (at < buf.length) {
    const len = buf.readUInt32BE(at);
    const type = buf.toString("ascii", at + 4, at + 8);
    const data = buf.subarray(at + 8, at + 8 + len);
    const crc = buf.readUInt32BE(at + 8 + len);
    if (crc32(buf.subarray(at + 4, at + 8 + len)) >>> 0 !== crc) {
      throw new Error(`bad CRC in ${type}`);
    }
    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      if (data[8] !== 8 || data[9] !== 6 || data[12] !== 0) {
        throw new Error("not 8-bit RGBA, non-interlaced");
      }
    } else if (type === "IDAT") {
      idat.push(data);
    }
    at += 12 + len;
  }
  if (width !== height) throw new Error("not square");
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * 4;
  const rgba = new Uint8Array(stride * height);
  for (let y = 0; y < height; y++) {
    const row = y * (stride + 1);
    if (raw[row] !== 0) throw new Error(`row ${y} uses filter ${raw[row]}`);
    rgba.set(raw.subarray(row + 1, row + 1 + stride), y * stride);
  }
  return { size: width, rgba };
}
