import test from 'node:test'
import assert from 'node:assert/strict'
import zlib from 'node:zlib'
import { buildZip, crc32 } from '../../../src/identity/continuity/zipWriter.js'

test('crc32 matches zlib.crc32 for empty input', () => {
  const ours = crc32(Buffer.alloc(0))
  const expected = zlib.crc32(Buffer.alloc(0))
  assert.equal(ours, expected)
})

test('crc32 matches zlib.crc32 for sample text', () => {
  const buf = Buffer.from('The quick brown fox jumps over the lazy dog')
  assert.equal(crc32(buf), zlib.crc32(buf))
})

test('buildZip produces a valid store-mode archive with EOCD signature', () => {
  const archive = buildZip([
    { name: 'SOUL.md', data: Buffer.from('# Soul\n') },
    { name: 'MEMORY.md', data: Buffer.from('# Memory\n') },
    { name: 'skills.json', data: Buffer.from('{"skills":[]}') },
  ])

  assert.equal(archive.readUInt32LE(0), 0x04034b50, 'starts with local file header')
  const eocdSig = archive.readUInt32LE(archive.length - 22)
  assert.equal(eocdSig, 0x06054b50, 'ends with EOCD record')

  const totalEntries = archive.readUInt16LE(archive.length - 22 + 10)
  assert.equal(totalEntries, 3)
})

test('buildZip preserves filename and contents in local headers', () => {
  const data = Buffer.from('hello world')
  const archive = buildZip([{ name: 'greeting.txt', data }])
  const nameLen = archive.readUInt16LE(26)
  const name = archive.slice(30, 30 + nameLen).toString('utf8')
  assert.equal(name, 'greeting.txt')
  const fileStart = 30 + nameLen
  assert.deepEqual(archive.slice(fileStart, fileStart + data.length), data)
  const storedCrc = archive.readUInt32LE(14)
  assert.equal(storedCrc, crc32(data))
})
