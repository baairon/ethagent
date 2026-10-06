import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { decodeFunctionData, keccak256, parseAbi, type Hex } from 'viem'
import { encodeErrorResult } from 'viem'
import { advance, track } from '../../support/time.js'
import {
  assertVaultBytecode,
  confirmAgentInVault,
  confirmAgentWithdrawnFromVault,
  encodeDepositAgent,
  encodeRotateAgentURI,
  encodeSetMetadataOperator,
  encodeUnwrapAgent,
  isAgentInVault,
  readMetadataOperators,
  CURRENT_VAULT_BUILD,
  FIRST_COMMITTED_VAULT_BUILD,
  vaultBuildForCode,
  vaultBuildForHash,
  describeVaultRevert,
  type VaultBuild,
  resolveConfiguredVaultAddress,
  VAULT_ABI,
  VAULT_ADDRESSES,
  VAULT_DEPLOY_BYTECODE,
  VAULT_RUNTIME_BYTECODE,
  VAULT_RUNTIME_BYTECODE_HASH,
  VaultBytecodeMismatchError,
  formatVaultBytecodeMismatchDetail,
  vaultAddressForChain,
  type AssertVaultBytecodeClient,
} from '../../../src/identity/registry/vault.js'

const REGISTRY = '0x8004A169fb4a3325136Eb29fA0CEB6D2e539a432' as `0x${string}`
const VAULT = '0x00000000000000000000000000000000000077ab' as `0x${string}`
const OWNER = '0x000000000000000000000000000000000000abcd' as `0x${string}`
const OPERATOR = '0x000000000000000000000000000000000000bEEF' as `0x${string}`
const RECIPIENT = '0x000000000000000000000000000000000000d00d' as `0x${string}`

const ERC721_ABI = parseAbi([
  'function safeTransferFrom(address from, address to, uint256 tokenId)',
])

test('encodeDepositAgent encodes registry.safeTransferFrom(owner, vault, agentId)', () => {
  const { to, data } = encodeDepositAgent({
    registry: REGISTRY,
    agentId: 42n,
    walletAddress: OWNER,
    vaultAddress: VAULT,
  })

  assert.equal(to.toLowerCase(), REGISTRY.toLowerCase())
  const decoded = decodeFunctionData({ abi: ERC721_ABI, data })
  assert.equal(decoded.functionName, 'safeTransferFrom')
  const args = decoded.args as readonly [`0x${string}`, `0x${string}`, bigint]
  assert.equal(args[0].toLowerCase(), OWNER.toLowerCase())
  assert.equal(args[1].toLowerCase(), VAULT.toLowerCase())
  assert.equal(args[2], 42n)
})

test('encodeSetMetadataOperator encodes vault.setMetadataOperator(registry, agentId, operator, approved)', () => {
  const { to, data } = encodeSetMetadataOperator({
    registry: REGISTRY,
    agentId: 7n,
    operator: OPERATOR,
    approved: true,
    vaultAddress: VAULT,
  })

  assert.equal(to.toLowerCase(), VAULT.toLowerCase())
  const decoded = decodeFunctionData({ abi: VAULT_ABI, data })
  assert.equal(decoded.functionName, 'setMetadataOperator')
  const args = decoded.args as readonly [`0x${string}`, bigint, `0x${string}`, boolean]
  assert.equal(args[0].toLowerCase(), REGISTRY.toLowerCase())
  assert.equal(args[1], 7n)
  assert.equal(args[2].toLowerCase(), OPERATOR.toLowerCase())
  assert.equal(args[3], true)
})

test('encodeSetMetadataOperator with approved=false encodes the revoke variant', () => {
  const { data } = encodeSetMetadataOperator({
    registry: REGISTRY,
    agentId: 7n,
    operator: OPERATOR,
    approved: false,
    vaultAddress: VAULT,
  })
  const decoded = decodeFunctionData({ abi: VAULT_ABI, data })
  const args = decoded.args as readonly [`0x${string}`, bigint, `0x${string}`, boolean]
  assert.equal(args[3], false)
})

test('encodeRotateAgentURI encodes vault.rotateAgentURI(registry, agentId, newURI)', () => {
  const newURI = 'ipfs://bafkreitestcid'
  const { to, data } = encodeRotateAgentURI({
    registry: REGISTRY,
    agentId: 999n,
    newURI,
    vaultAddress: VAULT,
  })

  assert.equal(to.toLowerCase(), VAULT.toLowerCase())
  const decoded = decodeFunctionData({ abi: VAULT_ABI, data })
  assert.equal(decoded.functionName, 'rotateAgentURI')
  const args = decoded.args as readonly [`0x${string}`, bigint, string]
  assert.equal(args[0].toLowerCase(), REGISTRY.toLowerCase())
  assert.equal(args[1], 999n)
  assert.equal(args[2], newURI)
})

test('encodeUnwrapAgent encodes vault.unwrap(registry, agentId, recipient)', () => {
  const { to, data } = encodeUnwrapAgent({
    registry: REGISTRY,
    agentId: 1n,
    recipient: RECIPIENT,
    vaultAddress: VAULT,
  })

  assert.equal(to.toLowerCase(), VAULT.toLowerCase())
  const decoded = decodeFunctionData({ abi: VAULT_ABI, data })
  assert.equal(decoded.functionName, 'unwrap')
  const args = decoded.args as readonly [`0x${string}`, bigint, `0x${string}`]
  assert.equal(args[0].toLowerCase(), REGISTRY.toLowerCase())
  assert.equal(args[1], 1n)
  assert.equal(args[2].toLowerCase(), RECIPIENT.toLowerCase())
})

test('isAgentInVault reports inVault=false when vault.agentOwner returns the zero address', async () => {
  const client = {
    readContract: async () => '0x0000000000000000000000000000000000000000' as `0x${string}`,
  } as unknown as Parameters<typeof isAgentInVault>[0]['client']
  const result = await isAgentInVault({
    client,
    vaultAddress: VAULT,
    registry: REGISTRY,
    agentId: 5n,
  })
  assert.deepEqual(result, { inVault: false })
})

test('isAgentInVault reports inVault=true and surfaces the vault-level owner', async () => {
  const client = {
    readContract: async () => OWNER,
  } as unknown as Parameters<typeof isAgentInVault>[0]['client']
  const result = await isAgentInVault({
    client,
    vaultAddress: VAULT,
    registry: REGISTRY,
    agentId: 5n,
  })
  assert.equal(result.inVault, true)
  assert.equal(result.ownerAddress?.toLowerCase(), OWNER.toLowerCase())
})

test('readMetadataOperators surfaces a failed read instead of reporting the operator as not approved', async () => {
  const candidates = [OPERATOR, RECIPIENT] as const
  const client = {
    readContract: async (args: { args?: readonly unknown[] }) => {
      const operatorArg = args.args?.[2] as `0x${string}` | undefined
      if (operatorArg?.toLowerCase() === OPERATOR.toLowerCase()) return true
      throw new Error('boom')
    },
  } as unknown as Parameters<typeof readMetadataOperators>[0]['client']
  await assert.rejects(
    () => readMetadataOperators({ client, vaultAddress: VAULT, registry: REGISTRY, agentId: 5n, candidates }),
    /boom/,
  )
  const approvedOnly = await readMetadataOperators({ client, vaultAddress: VAULT, registry: REGISTRY, agentId: 5n, candidates: [OPERATOR] })
  assert.equal(approvedOnly[OPERATOR], true)
})

test('vaultAddressForChain returns undefined when no deployment is recorded', () => {
  for (const chainId of [1, 8453]) {
    if (VAULT_ADDRESSES[chainId]) continue
    assert.equal(vaultAddressForChain(chainId), undefined)
  }
})

test('VAULT_DEPLOY_BYTECODE is a 0x-prefixed even-length hex string', () => {
  assert.match(VAULT_DEPLOY_BYTECODE, /^0x[0-9a-f]+$/i)
  assert.equal((VAULT_DEPLOY_BYTECODE.length - 2) % 2, 0, 'bytecode hex must have even length')
  assert.ok(VAULT_DEPLOY_BYTECODE.length > 1000, 'bytecode looks too short')
})

test('resolveConfiguredVaultAddress prefers user config over hardcoded map', () => {
  const userVault = '0x1111111111111111111111111111111111111111' as `0x${string}`
  const cfg = { '8453': userVault }
  assert.equal(
    resolveConfiguredVaultAddress(cfg, 8453)?.toLowerCase(),
    userVault.toLowerCase(),
  )
})

test('resolveConfiguredVaultAddress falls back to hardcoded map when config is empty', () => {
  for (const chainId of [1, 8453]) {
    if (VAULT_ADDRESSES[chainId]) continue
    assert.equal(resolveConfiguredVaultAddress(undefined, chainId), undefined)
    assert.equal(resolveConfiguredVaultAddress({}, chainId), undefined)
  }
})

test('resolveConfiguredVaultAddress checksums the address regardless of input casing', () => {
  const lower = '0xd8da6bf26964af9d7eed9e03e53415d37aa96045'
  const result = resolveConfiguredVaultAddress({ '1': lower }, 1)
  assert.ok(result, 'expected an address')
  assert.equal(result, '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045')
})

test('readMetadataOperators with empty candidates list returns an empty map', async () => {
  const client = {
    readContract: async () => true,
  } as unknown as Parameters<typeof readMetadataOperators>[0]['client']
  const result = await readMetadataOperators({
    client,
    vaultAddress: VAULT,
    registry: REGISTRY,
    agentId: 1n,
    candidates: [],
  })
  assert.deepEqual(result, {})
})

test('Vault gating error message names the chain so the user sees why advanced is disabled', async () => {
  const { VaultUnavailableError } = await import('../../../src/identity/manager/custody/preflight.js')
  const err = new VaultUnavailableError(8453)
  assert.match(err.message, /Vault is not deployed for chainId 8453/)
  assert.equal(err.name, 'VaultUnavailableError')
})

test('TS bytecode constants match the on-disk Foundry artifact (drift guard)', (t) => {
  let artifactJSON: string
  try {
    artifactJSON = readFileSync('contracts/out/Vault.sol/Vault.json', 'utf8')
  } catch (err: any) {
    if (err.code === 'ENOENT') {
      t.skip('contracts/out/Vault.sol/Vault.json not found (forge build not run locally)')
      return
    }
    throw err
  }
  const artifact = JSON.parse(artifactJSON) as { bytecode: { object: Hex }; deployedBytecode: { object: Hex } }
  assert.equal(
    artifact.bytecode.object.toLowerCase(),
    VAULT_DEPLOY_BYTECODE.toLowerCase(),
    'VAULT_DEPLOY_BYTECODE has drifted from contracts/out artifact; recompile and repaste',
  )
  assert.equal(
    artifact.deployedBytecode.object.toLowerCase(),
    VAULT_RUNTIME_BYTECODE.toLowerCase(),
    'VAULT_RUNTIME_BYTECODE has drifted from contracts/out artifact; recompile and repaste',
  )
  assert.equal(
    keccak256(artifact.deployedBytecode.object).toLowerCase(),
    VAULT_RUNTIME_BYTECODE_HASH.toLowerCase(),
  )
})

test('VaultBytecodeMismatchError carries diagnostic fields and renders a useful detail', () => {
  const txHash = ('0x' + 'ab'.repeat(32)) as Hex
  const observed = ('0x' + '11'.repeat(32)) as Hex
  const err = new VaultBytecodeMismatchError(VAULT, observed, 1234, txHash)
  assert.equal(err.name, 'VaultBytecodeMismatchError')
  assert.equal(err.vaultAddress, VAULT)
  assert.equal(err.observedHash, observed)
  assert.equal(err.observedLength, 1234)
  assert.equal(err.txHash, txHash)
  assert.equal(err.expectedHash, VAULT_RUNTIME_BYTECODE_HASH)
  assert.equal(err.expectedLength, (VAULT_RUNTIME_BYTECODE.length - 2) / 2)
  const detail = formatVaultBytecodeMismatchDetail(err)
  assert.match(detail, /Vault address:\s+0x[0-9a-fA-F]+/)
  assert.match(detail, /Deploy tx:\s+0xab/)
  assert.match(detail, /Expected hash:/)
  assert.match(detail, /Observed hash:/)
  assert.match(detail, /Observed length:\s+1234 bytes/)
})

test('formatVaultBytecodeMismatchDetail surfaces the no-code case explicitly', () => {
  const err = new VaultBytecodeMismatchError(VAULT, null, 0)
  const detail = formatVaultBytecodeMismatchDetail(err)
  assert.match(detail, /Observed code:\s+none/)
  assert.doesNotMatch(detail, /Observed hash:/)
  assert.doesNotMatch(detail, /Deploy tx:/)
})

test('assertVaultBytecode never passes blockNumber to getBytecode (latest only, matches ethers/foundry)', async () => {
  const observedKeys: string[][] = []
  const client = {
    getBytecode: async (args: Record<string, unknown>) => {
      observedKeys.push(Object.keys(args))
      return VAULT_RUNTIME_BYTECODE
    },
  } as unknown as AssertVaultBytecodeClient
  await assertVaultBytecode(client, VAULT)
  assert.equal(observedKeys.length, 1)
  assert.deepEqual(observedKeys[0], ['address'])
})

// Records each pause instead of sleeping, so the pacing is checked without waiting.
function recordedPauses(): { pauses: number[]; pause: (ms: number) => Promise<void> } {
  const pauses: number[] = []
  return { pauses, pause: async (ms: number) => { pauses.push(ms) } }
}

const PACING = { blockTimeMs: 2_000 }

test('assertVaultBytecode looks again on a new block past a transient BlockNotFoundError', async () => {
  let calls = 0
  const client = {
    getBytecode: async () => {
      calls += 1
      if (calls === 1) {
        const err = new Error('block not found: 0x2ba2350')
        err.name = 'BlockNotFoundError'
        throw err
      }
      return VAULT_RUNTIME_BYTECODE
    },
  } as unknown as AssertVaultBytecodeClient
  const { pauses, pause } = recordedPauses()
  const build = await assertVaultBytecode(client, VAULT, undefined, { ...PACING, pause })
  assert.equal(calls, 2)
  assert.deepEqual(pauses, [2_000])
  assert.equal(build.id, 'current')
})

test('assertVaultBytecode looks again past a "header not found" answer', async () => {
  let calls = 0
  const client = {
    getBytecode: async () => {
      calls += 1
      if (calls === 1) {
        const err = new Error('Missing or invalid parameters\nDetails: header not found')
        err.name = 'InvalidParamsRpcError'
        throw err
      }
      return VAULT_RUNTIME_BYTECODE
    },
  } as unknown as AssertVaultBytecodeClient
  const { pause } = recordedPauses()
  await assertVaultBytecode(client, VAULT, undefined, { ...PACING, pause })
  assert.equal(calls, 2)
})

test('assertVaultBytecode looks again on empty code (follower behind the deploy block)', async () => {
  let calls = 0
  const client = {
    getBytecode: async () => {
      calls += 1
      if (calls === 1) return '0x' as Hex
      return VAULT_RUNTIME_BYTECODE
    },
  } as unknown as AssertVaultBytecodeClient
  const { pause } = recordedPauses()
  await assertVaultBytecode(client, VAULT, undefined, { ...PACING, pause })
  assert.equal(calls, 2)
})

test('assertVaultBytecode waits for the endpoint head to reach the receipt block before reading', async () => {
  const heads = [99n, 99n, 100n]
  let reads = 0
  const client = {
    getBytecode: async () => {
      reads += 1
      return VAULT_RUNTIME_BYTECODE
    },
  } as unknown as AssertVaultBytecodeClient
  const { pauses, pause } = recordedPauses()
  await assertVaultBytecode(client, VAULT, ('0x' + 'ab'.repeat(32)) as Hex, {
    ...PACING,
    pause,
    receiptBlock: 100n,
    getBlockNumber: async () => heads.shift() ?? 100n,
  })
  assert.equal(reads, 1)
  assert.deepEqual(pauses, [2_000, 4_000])
})

test('assertVaultBytecode doubles its pause from the block time and gives up at the backoff ceiling', async () => {
  let calls = 0
  const client = {
    getBytecode: async () => {
      calls += 1
      const err = new Error('Missing or invalid parameters\nDetails: header not found')
      err.name = 'InvalidParamsRpcError'
      throw err
    },
  } as unknown as AssertVaultBytecodeClient
  const { pauses, pause } = recordedPauses()
  await assert.rejects(
    () => assertVaultBytecode(client, VAULT, undefined, { ...PACING, pause }),
    (err: unknown) => err instanceof Error && err.name === 'InvalidParamsRpcError',
  )
  assert.deepEqual(pauses, [2_000, 4_000, 8_000, 16_000, 32_000])
  assert.equal(calls, 6)
})

test('assertVaultBytecode reports no code once the ceiling passes with the address still empty', async () => {
  const client = { getBytecode: async () => '0x' as Hex } as unknown as AssertVaultBytecodeClient
  const { pause } = recordedPauses()
  await assert.rejects(
    () => assertVaultBytecode(client, VAULT, undefined, { blockTimeMs: 12_000, pause }),
    (err: unknown) => err instanceof VaultBytecodeMismatchError && err.observedHash === null,
  )
})

test('assertVaultBytecode spends real block-time pauses that a cancel ends', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  let calls = 0
  const client = {
    getBytecode: async () => {
      calls += 1
      return calls < 3 ? '0x' as Hex : VAULT_RUNTIME_BYTECODE
    },
  } as unknown as AssertVaultBytecodeClient
  const done = track(assertVaultBytecode(client, VAULT, undefined, PACING))
  await advance(t, 1_750)
  assert.equal(calls, 1)
  await advance(t, 750)
  assert.equal(calls, 2)
  await advance(t, 4_500)
  assert.equal(done.settled, true)
  assert.equal(done.error, undefined)

  const controller = new AbortController()
  const empty = { getBytecode: async () => '0x' as Hex } as unknown as AssertVaultBytecodeClient
  const cancelled = track(assertVaultBytecode(empty, VAULT, undefined, { ...PACING, signal: controller.signal }))
  await advance(t, 500)
  controller.abort()
  await advance(t, 250)
  assert.equal(cancelled.settled, true)
  assert.equal((cancelled.error as Error).name, 'AbortError')
})

test('assertVaultBytecode never retries a real bytecode mismatch', async () => {
  let calls = 0
  const wrongCode = ('0x' + '00'.repeat(32)) as Hex
  const client = {
    getBytecode: async () => {
      calls += 1
      return wrongCode
    },
  } as unknown as AssertVaultBytecodeClient
  await assert.rejects(
    () => assertVaultBytecode(client, VAULT, undefined, PACING),
    (err: unknown) => err instanceof VaultBytecodeMismatchError,
  )
  assert.equal(calls, 1)
})

test('assertVaultBytecode accepts any known build for an existing Vault but only the current one after a deploy', async () => {
  const otherCode = ('0x' + '60'.repeat(40)) as Hex
  const otherBuild: VaultBuild = {
    id: 'pre-release',
    label: 'test build without heldAgent',
    runtimeHash: keccak256(otherCode),
    hasHeldAgent: false,
  }
  const client = { getBytecode: async () => otherCode } as unknown as AssertVaultBytecodeClient
  const build = await assertVaultBytecode(client, VAULT, undefined, { ...PACING, builds: [CURRENT_VAULT_BUILD, otherBuild] })
  assert.equal(build.id, 'pre-release')
  assert.equal(build.hasHeldAgent, false)
  await assert.rejects(
    () => assertVaultBytecode(client, VAULT, ('0x' + 'ab'.repeat(32)) as Hex, { ...PACING, builds: [CURRENT_VAULT_BUILD, otherBuild] }),
    (err: unknown) => err instanceof VaultBytecodeMismatchError && /intercepted/.test(err.message),
  )
})

test('the builds table knows the current, first committed, and pre-release builds by runtime hash', () => {
  assert.equal(vaultBuildForCode(VAULT_RUNTIME_BYTECODE)?.id, 'current')
  assert.equal(vaultBuildForHash(FIRST_COMMITTED_VAULT_BUILD.runtimeHash)?.id, 'first-committed')
  assert.equal(FIRST_COMMITTED_VAULT_BUILD.runtimeHash, '0xfea7e898c15b1e72a5a54ec35bdad917dfed8ea3d4bfe078fafa3cf00784cde4')
  const preRelease = vaultBuildForHash('0xF8F2319752C7B0A6382EF0D233426D0BD605641E65300A4E1B2ECE5479A64C13')
  assert.equal(preRelease?.id, 'pre-release')
  assert.equal(preRelease?.hasHeldAgent, false)
  assert.equal(vaultBuildForHash(('0x' + '11'.repeat(32)) as Hex), undefined)
})

test('VAULT_ABI names the Vault custom errors by their selectors', () => {
  const selectors = Object.fromEntries(
    ['AlreadyDeposited', 'UnexpectedToken', 'NotOwner', 'NotAuthorized'].map(name => [
      name,
      encodeErrorResult({ abi: VAULT_ABI, errorName: name as 'NotOwner' }),
    ]),
  )
  assert.deepEqual(selectors, {
    AlreadyDeposited: '0xd5a82115',
    UnexpectedToken: '0x9667ffdf',
    NotOwner: '0x30cd7471',
    NotAuthorized: '0xea8e4eb5',
  })
  const revert = Object.assign(new Error('execution reverted'), { code: 3, data: '0x30cd7471' })
  assert.match(describeVaultRevert(new Error('outer', { cause: revert })) ?? '', /NotOwner/)
})

test('confirmAgentInVault looks again past a transient inVault:false (follower behind deposit block)', async () => {
  let calls = 0
  const client = {
    readContract: async () => {
      calls += 1
      if (calls === 1) return '0x0000000000000000000000000000000000000000' as `0x${string}`
      return OWNER
    },
  } as unknown as Parameters<typeof confirmAgentInVault>[0]['client']
  const { pause } = recordedPauses()
  const status = await confirmAgentInVault({ client, vaultAddress: VAULT, registry: REGISTRY, agentId: 5n, pacing: { ...PACING, pause } })
  assert.equal(calls, 2)
  assert.equal(status.inVault, true)
  assert.equal(status.ownerAddress.toLowerCase(), OWNER.toLowerCase())
})

test('confirmAgentInVault looks again past a thrown read error', async () => {
  let calls = 0
  const client = {
    readContract: async () => {
      calls += 1
      if (calls === 1) throw new Error('Missing or invalid parameters: header not found')
      return OWNER
    },
  } as unknown as Parameters<typeof confirmAgentInVault>[0]['client']
  const { pause } = recordedPauses()
  const status = await confirmAgentInVault({ client, vaultAddress: VAULT, registry: REGISTRY, agentId: 5n, pacing: { ...PACING, pause } })
  assert.equal(calls, 2)
  assert.equal(status.ownerAddress.toLowerCase(), OWNER.toLowerCase())
})

test('confirmAgentInVault gives up at the ceiling on persistent inVault:false and throws with vault context', async () => {
  let calls = 0
  const client = {
    readContract: async () => {
      calls += 1
      return '0x0000000000000000000000000000000000000000' as `0x${string}`
    },
  } as unknown as Parameters<typeof confirmAgentInVault>[0]['client']
  const { pauses, pause } = recordedPauses()
  await assert.rejects(
    () => confirmAgentInVault({ client, vaultAddress: VAULT, registry: REGISTRY, agentId: 5n, pacing: { ...PACING, pause } }),
    (err: unknown) => err instanceof Error
      && err.message.toLowerCase().includes(VAULT.toLowerCase())
      && err.message.includes('#5'),
  )
  assert.equal(calls, pauses.length + 1)
  assert.ok(pauses.every(ms => ms <= 60_000))
})

test('confirmAgentInVault surfaces the last error once the ceiling passes', async () => {
  const client = {
    readContract: async () => {
      throw new Error('persistent rpc timeout')
    },
  } as unknown as Parameters<typeof confirmAgentInVault>[0]['client']
  const { pause } = recordedPauses()
  await assert.rejects(
    () => confirmAgentInVault({ client, vaultAddress: VAULT, registry: REGISTRY, agentId: 5n, pacing: { ...PACING, pause } }),
    (err: unknown) => err instanceof Error && /persistent rpc timeout/.test(err.message),
  )
})

test('confirmAgentInVault stops at once on a revert', async () => {
  let calls = 0
  const client = {
    readContract: async () => {
      calls += 1
      throw Object.assign(new Error('execution reverted'), { code: 3 })
    },
  } as unknown as Parameters<typeof confirmAgentInVault>[0]['client']
  const { pause } = recordedPauses()
  await assert.rejects(() => confirmAgentInVault({ client, vaultAddress: VAULT, registry: REGISTRY, agentId: 5n, pacing: { ...PACING, pause } }))
  assert.equal(calls, 1)
})

test('confirmAgentWithdrawnFromVault looks again until the token owner is the withdraw recipient', async () => {
  let ownerOfCalls = 0
  const client = {
    readContract: async (call: { functionName: string }) => {
      if (call.functionName === 'agentOwner') return '0x0000000000000000000000000000000000000000' as `0x${string}`
      if (call.functionName === 'ownerOf') {
        ownerOfCalls += 1
        return ownerOfCalls === 1 ? VAULT : RECIPIENT
      }
      throw new Error(`unexpected read: ${call.functionName}`)
    },
  } as unknown as Parameters<typeof confirmAgentWithdrawnFromVault>[0]['client']
  const { pause } = recordedPauses()
  const status = await confirmAgentWithdrawnFromVault({
    client,
    vaultAddress: VAULT,
    registry: REGISTRY,
    agentId: 5n,
    recipient: RECIPIENT,
    pacing: { ...PACING, pause },
  })

  assert.equal(ownerOfCalls, 2)
  assert.equal(status.inVault, false)
  assert.equal(status.ownerAddress.toLowerCase(), RECIPIENT.toLowerCase())
})
