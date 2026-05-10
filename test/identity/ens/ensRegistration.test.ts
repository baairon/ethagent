import test from 'node:test'
import assert from 'node:assert/strict'
import { decodeFunctionData, parseAbi, type Hex } from 'viem'
import {
  buildCommitment,
  encodeCommitTransaction,
  encodeRegisterTransaction,
  ETH_REGISTRAR_CONTROLLER_MAINNET,
  generateRegistrationSecret,
  ONE_YEAR_SECONDS,
  validateRegistrableName,
  type EnsRegistrationReadClient,
  readNameAvailable,
  readRentPrice,
} from '../../../src/identity/ens/ensRegistration.js'

const OWNER = '0x000000000000000000000000000000000000aBcD' as `0x${string}`
const SECRET = ('0x' + '11'.repeat(32)) as Hex

const CONTROLLER_ABI = parseAbi([
  'function commit(bytes32 commitment)',
  'function register(string name, address owner, uint256 duration, bytes32 secret, address resolver, bytes[] data, bool reverseRecord, uint16 ownerControlledFuses) payable',
  'function rentPrice(string name, uint256 duration) view returns (uint256 base, uint256 premium)',
  'function available(string name) view returns (bool)',
])

test('validateRegistrableName accepts a normal lowercase label', () => {
  const result = validateRegistrableName('myname')
  assert.equal(result.ok, true)
  if (result.ok) assert.equal(result.label, 'myname')
})

test('validateRegistrableName rejects a label with a dot', () => {
  const result = validateRegistrableName('my.name')
  assert.equal(result.ok, false)
  if (!result.ok) assert.equal(result.reason, 'contains-dot')
})

test('validateRegistrableName rejects too-short labels', () => {
  const result = validateRegistrableName('ab')
  assert.equal(result.ok, false)
  if (!result.ok) assert.equal(result.reason, 'too-short')
})

test('validateRegistrableName lowercases input and rejects symbols', () => {
  const upper = validateRegistrableName('MyName')
  assert.equal(upper.ok, true)
  if (upper.ok) assert.equal(upper.label, 'myname')
  assert.equal(validateRegistrableName('my_name').ok, false)
  assert.equal(validateRegistrableName('my name').ok, false)
})

test('validateRegistrableName rejects leading or trailing hyphen', () => {
  const a = validateRegistrableName('-foo')
  const b = validateRegistrableName('foo-')
  assert.equal(a.ok, false)
  assert.equal(b.ok, false)
  if (!a.ok) assert.equal(a.reason, 'leading-hyphen')
  if (!b.ok) assert.equal(b.reason, 'trailing-hyphen')
})

test('buildCommitment is deterministic for the same inputs', () => {
  const a = buildCommitment({ label: 'myname', owner: OWNER, durationSeconds: BigInt(ONE_YEAR_SECONDS), secret: SECRET })
  const b = buildCommitment({ label: 'myname', owner: OWNER, durationSeconds: BigInt(ONE_YEAR_SECONDS), secret: SECRET })
  assert.equal(a.commitment, b.commitment)
  assert.match(a.commitment, /^0x[0-9a-fA-F]{64}$/)
})

test('buildCommitment changes when the secret changes', () => {
  const a = buildCommitment({ label: 'myname', owner: OWNER, durationSeconds: BigInt(ONE_YEAR_SECONDS), secret: SECRET })
  const otherSecret = ('0x' + '22'.repeat(32)) as Hex
  const b = buildCommitment({ label: 'myname', owner: OWNER, durationSeconds: BigInt(ONE_YEAR_SECONDS), secret: otherSecret })
  assert.notEqual(a.commitment, b.commitment)
})

test('encodeCommitTransaction targets the controller and encodes the commitment', () => {
  const built = buildCommitment({ label: 'myname', owner: OWNER, durationSeconds: BigInt(ONE_YEAR_SECONDS), secret: SECRET })
  const tx = encodeCommitTransaction(built.commitment)
  assert.equal(tx.to.toLowerCase(), ETH_REGISTRAR_CONTROLLER_MAINNET.toLowerCase())
  const decoded = decodeFunctionData({ abi: CONTROLLER_ABI, data: tx.data })
  assert.equal(decoded.functionName, 'commit')
  assert.equal((decoded.args as readonly [Hex])[0], built.commitment)
})

test('encodeRegisterTransaction encodes register() with the correct args and a buffered value', () => {
  const price = { base: 1_000_000_000_000_000n, premium: 0n, total: 1_000_000_000_000_000n }
  const tx = encodeRegisterTransaction({
    label: 'myname',
    owner: OWNER,
    durationSeconds: BigInt(ONE_YEAR_SECONDS),
    secret: SECRET,
    rentPrice: price,
  })
  assert.equal(tx.to.toLowerCase(), ETH_REGISTRAR_CONTROLLER_MAINNET.toLowerCase())
  const decoded = decodeFunctionData({ abi: CONTROLLER_ABI, data: tx.data })
  assert.equal(decoded.functionName, 'register')
  const args = decoded.args as readonly [string, `0x${string}`, bigint, Hex, `0x${string}`, readonly Hex[], boolean, number]
  assert.equal(args[0], 'myname')
  assert.equal(args[1].toLowerCase(), OWNER.toLowerCase())
  assert.equal(args[2], BigInt(ONE_YEAR_SECONDS))
  assert.equal(args[3], SECRET)
  assert.equal(args[6], false)
  assert.equal(args[7], 0)
  const valueBig = BigInt(tx.value)
  assert.ok(valueBig > price.total, 'value should include the safety buffer')
  assert.ok(valueBig <= (price.total * 11n) / 10n, 'value buffer should be at most 10%')
})

test('generateRegistrationSecret returns a 32-byte hex string', () => {
  const secret = generateRegistrationSecret()
  assert.match(secret, /^0x[0-9a-fA-F]{64}$/)
  const other = generateRegistrationSecret()
  assert.notEqual(secret, other)
})

test('readNameAvailable forwards the label to the controller and returns the result', async () => {
  const calls: Array<{ functionName: string; args: readonly unknown[] }> = []
  const client = {
    readContract: async (params: { functionName: string; args?: readonly unknown[] }) => {
      calls.push({ functionName: params.functionName, args: params.args ?? [] })
      return true
    },
  } as unknown as EnsRegistrationReadClient
  const ok = await readNameAvailable(client, 'myname')
  assert.equal(ok, true)
  assert.equal(calls.length, 1)
  assert.equal(calls[0]!.functionName, 'available')
  assert.deepEqual(calls[0]!.args, ['myname'])
})

test('readRentPrice destructures base + premium and returns total', async () => {
  const client = {
    readContract: async () => [42n, 8n],
  } as unknown as EnsRegistrationReadClient
  const price = await readRentPrice(client, 'myname', BigInt(ONE_YEAR_SECONDS))
  assert.equal(price.base, 42n)
  assert.equal(price.premium, 8n)
  assert.equal(price.total, 50n)
})
