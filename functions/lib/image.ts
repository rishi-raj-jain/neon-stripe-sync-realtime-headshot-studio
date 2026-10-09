/**
 * Sniff the real format from magic bytes. Never trust the declared Content-Type: browsers
 * happily label an iPhone HEIC as image/jpeg after a rename.
 */
type SniffedImage = 'image/jpeg' | 'image/png' | 'image/webp' | 'image/heic' | 'unknown'

export function sniffImage(bytes: Buffer): SniffedImage {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'image/jpeg'
  }
  if (bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return 'image/png'
  }
  if (bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP') {
    return 'image/webp'
  }
  // ISO-BMFF: "ftyp" at offset 4, then a HEIF brand.
  if (bytes.toString('ascii', 4, 8) === 'ftyp') {
    const brand = bytes.toString('ascii', 8, 12)
    if (['heic', 'heix', 'hevc', 'hevx', 'mif1', 'msf1'].includes(brand)) return 'image/heic'
  }
  return 'unknown'
}
