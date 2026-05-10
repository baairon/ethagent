export type ZipEntry = {
  name: string
  data: Buffer
}

const crcTable = (() => {
  const table = new Uint32Array(256)
  for (let i = 0; i < 256; i++) {
    let c = i
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1)
    table[i] = c
  }
  return table
})()

export function crc32(buf: Buffer): number {
  let c = 0xFFFFFFFF
  for (let i = 0; i < buf.length; i++) {
    const byte = buf[i] as number
    c = (crcTable[(c ^ byte) & 0xff] as number) ^ (c >>> 8)
  }
  return (c ^ 0xFFFFFFFF) >>> 0
}

export function buildZip(entries: ZipEntry[], modifiedAt: Date = new Date()): Buffer {
  const dosTime = toDosTime(modifiedAt)
  const dosDate = toDosDate(modifiedAt)
  const localParts: Buffer[] = []
  const centralParts: Buffer[] = []
  let offset = 0
  for (const entry of entries) {
    const nameBuf = Buffer.from(entry.name, 'utf8')
    const crc = crc32(entry.data)
    const size = entry.data.length

    const localHeader = Buffer.alloc(30)
    localHeader.writeUInt32LE(0x04034b50, 0)
    localHeader.writeUInt16LE(20, 4)
    localHeader.writeUInt16LE(0x0800, 6)
    localHeader.writeUInt16LE(0, 8)
    localHeader.writeUInt16LE(dosTime, 10)
    localHeader.writeUInt16LE(dosDate, 12)
    localHeader.writeUInt32LE(crc, 14)
    localHeader.writeUInt32LE(size, 18)
    localHeader.writeUInt32LE(size, 22)
    localHeader.writeUInt16LE(nameBuf.length, 26)
    localHeader.writeUInt16LE(0, 28)
    localParts.push(localHeader, nameBuf, entry.data)

    const centralHeader = Buffer.alloc(46)
    centralHeader.writeUInt32LE(0x02014b50, 0)
    centralHeader.writeUInt16LE(20, 4)
    centralHeader.writeUInt16LE(20, 6)
    centralHeader.writeUInt16LE(0x0800, 8)
    centralHeader.writeUInt16LE(0, 10)
    centralHeader.writeUInt16LE(dosTime, 12)
    centralHeader.writeUInt16LE(dosDate, 14)
    centralHeader.writeUInt32LE(crc, 16)
    centralHeader.writeUInt32LE(size, 20)
    centralHeader.writeUInt32LE(size, 24)
    centralHeader.writeUInt16LE(nameBuf.length, 28)
    centralHeader.writeUInt16LE(0, 30)
    centralHeader.writeUInt16LE(0, 32)
    centralHeader.writeUInt16LE(0, 34)
    centralHeader.writeUInt16LE(0, 36)
    centralHeader.writeUInt32LE(0, 38)
    centralHeader.writeUInt32LE(offset, 42)
    centralParts.push(centralHeader, nameBuf)

    offset += localHeader.length + nameBuf.length + entry.data.length
  }

  const centralBuf = Buffer.concat(centralParts)
  const localBuf = Buffer.concat(localParts)
  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(0x06054b50, 0)
  eocd.writeUInt16LE(0, 4)
  eocd.writeUInt16LE(0, 6)
  eocd.writeUInt16LE(entries.length, 8)
  eocd.writeUInt16LE(entries.length, 10)
  eocd.writeUInt32LE(centralBuf.length, 12)
  eocd.writeUInt32LE(localBuf.length, 16)
  eocd.writeUInt16LE(0, 20)

  return Buffer.concat([localBuf, centralBuf, eocd])
}

function toDosTime(date: Date): number {
  return ((date.getHours() & 0x1f) << 11) | ((date.getMinutes() & 0x3f) << 5) | ((date.getSeconds() / 2) & 0x1f)
}

function toDosDate(date: Date): number {
  const year = Math.max(1980, date.getFullYear()) - 1980
  return ((year & 0x7f) << 9) | (((date.getMonth() + 1) & 0x0f) << 5) | (date.getDate() & 0x1f)
}
