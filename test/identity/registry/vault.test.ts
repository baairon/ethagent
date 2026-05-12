import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { decodeFunctionData, keccak256, parseAbi, type Hex } from 'viem'
import {
  assertVaultBytecode,
  confirmAgentInVault,
  confirmAgentWithdrawnFromVault,
  discoverVaultedTokens,
  encodeDepositAgent,
  encodeRotateAgentURI,
  encodeSetMetadataOperator,
  encodeUnwrapAgent,
  isAgentInVault,
  readMetadataOperators,
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

test('readMetadataOperators returns per-address authorization map and treats RPC errors as false', async () => {
  const candidates = [OPERATOR, RECIPIENT] as const
  const client = {
    readContract: async (args: { args?: readonly unknown[] }) => {
      const operatorArg = args.args?.[2] as `0x${string}` | undefined
      if (operatorArg?.toLowerCase() === OPERATOR.toLowerCase()) return true
      throw new Error('boom')
    },
  } as unknown as Parameters<typeof readMetadataOperators>[0]['client']
  const result = await readMetadataOperators({
    client,
    vaultAddress: VAULT,
    registry: REGISTRY,
    agentId: 5n,
    candidates,
  })
  assert.equal(result[OPERATOR], true)
  assert.equal(result[RECIPIENT], false)
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
  const { VaultUnavailableError } = await import('../../../src/identity/hub/custody/preflight.js')
  const err = new VaultUnavailableError(8453)
  assert.match(err.message, /Vault is not deployed for chainId 8453/)
  assert.equal(err.name, 'VaultUnavailableError')
})

test('TS bytecode constants match the on-disk Foundry artifact (drift guard)', () => {
  const artifact = JSON.parse(
    readFileSync('contracts/out/Vault.sol/Vault.json', 'utf8'),
  ) as { bytecode: { object: Hex }; deployedBytecode: { object: Hex } }
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

test('assertVaultBytecode polls past a transient BlockNotFoundError before succeeding', async () => {
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
  await assertVaultBytecode(client, VAULT)
  assert.equal(calls, 2)
})

test('assertVaultBytecode polls past an InvalidParamsRpcError-shaped throw (publicnode -32602 "header not found")', async () => {
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
  await assertVaultBytecode(client, VAULT)
  assert.equal(calls, 2)
})

test('assertVaultBytecode polls past arbitrary throws (any provider error during a fresh-deploy read is treated as transient)', async () => {
  let calls = 0
  const client = {
    getBytecode: async () => {
      calls += 1
      if (calls === 1) throw new Error('completely unrelated provider message')
      return VAULT_RUNTIME_BYTECODE
    },
  } as unknown as AssertVaultBytecodeClient
  await assertVaultBytecode(client, VAULT)
  assert.equal(calls, 2)
})

test('assertVaultBytecode retries on empty code (follower latest behind newly-deployed contract)', async () => {
  let calls = 0
  const client = {
    getBytecode: async () => {
      calls += 1
      if (calls === 1) return '0x' as Hex
      return VAULT_RUNTIME_BYTECODE
    },
  } as unknown as AssertVaultBytecodeClient
  await assertVaultBytecode(client, VAULT)
  assert.equal(calls, 2)
})

test('assertVaultBytecode surfaces the last error after the retry budget is exhausted', async () => {
  let calls = 0
  const client = {
    getBytecode: async () => {
      calls += 1
      const err = new Error('Missing or invalid parameters\nDetails: header not found')
      err.name = 'InvalidParamsRpcError'
      throw err
    },
  } as unknown as AssertVaultBytecodeClient
  await assert.rejects(
    () => assertVaultBytecode(client, VAULT),
    (err: unknown) => err instanceof Error && err.name === 'InvalidParamsRpcError',
  )
  assert.equal(calls, 5)
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
    () => assertVaultBytecode(client, VAULT),
    (err: unknown) => err instanceof VaultBytecodeMismatchError,
  )
  assert.equal(calls, 1)
})

test('confirmAgentInVault polls past a transient inVault:false (follower behind deposit block)', async () => {
  let calls = 0
  const client = {
    readContract: async () => {
      calls += 1
      if (calls === 1) return '0x0000000000000000000000000000000000000000' as `0x${string}`
      return OWNER
    },
  } as unknown as Parameters<typeof confirmAgentInVault>[0]['client']
  const status = await confirmAgentInVault({ client, vaultAddress: VAULT, registry: REGISTRY, agentId: 5n })
  assert.equal(calls, 2)
  assert.equal(status.inVault, true)
  assert.equal(status.ownerAddress.toLowerCase(), OWNER.toLowerCase())
})

test('confirmAgentInVault polls past a thrown read error', async () => {
  let calls = 0
  const client = {
    readContract: async () => {
      calls += 1
      if (calls === 1) throw new Error('Missing or invalid parameters: header not found')
      return OWNER
    },
  } as unknown as Parameters<typeof confirmAgentInVault>[0]['client']
  const status = await confirmAgentInVault({ client, vaultAddress: VAULT, registry: REGISTRY, agentId: 5n })
  assert.equal(calls, 2)
  assert.equal(status.ownerAddress.toLowerCase(), OWNER.toLowerCase())
})

test('confirmAgentInVault exhausts the budget on persistent inVault:false and throws with vault context', async () => {
  let calls = 0
  const client = {
    readContract: async () => {
      calls += 1
      return '0x0000000000000000000000000000000000000000' as `0x${string}`
    },
  } as unknown as Parameters<typeof confirmAgentInVault>[0]['client']
  await assert.rejects(
    () => confirmAgentInVault({ client, vaultAddress: VAULT, registry: REGISTRY, agentId: 5n }),
    (err: unknown) => err instanceof Error
      && err.message.toLowerCase().includes(VAULT.toLowerCase())
      && err.message.includes('#5'),
  )
  assert.equal(calls, 5)
})

test('confirmAgentInVault surfaces the last error after the retry budget exhausts', async () => {
  let calls = 0
  const client = {
    readContract: async () => {
      calls += 1
      throw new Error('persistent rpc timeout')
    },
  } as unknown as Parameters<typeof confirmAgentInVault>[0]['client']
  await assert.rejects(
    () => confirmAgentInVault({ client, vaultAddress: VAULT, registry: REGISTRY, agentId: 5n }),
    (err: unknown) => err instanceof Error && /persistent rpc timeout/.test(err.message),
  )
  assert.equal(calls, 5)
})

test('confirmAgentWithdrawnFromVault polls until the token owner is the withdraw recipient', async () => {
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
  const status = await confirmAgentWithdrawnFromVault({
    client,
    vaultAddress: VAULT,
    registry: REGISTRY,
    agentId: 5n,
    recipient: RECIPIENT,
  })

  assert.equal(ownerOfCalls, 2)
  assert.equal(status.inVault, false)
  assert.equal(status.ownerAddress.toLowerCase(), RECIPIENT.toLowerCase())
})

test('discoverVaultedTokens retries a single window after a transient getLogs throw and continues', async () => {
  let getLogsCalls = 0
  const client = {
    getBlockNumber: async () => 100n,
    getLogs: async () => {
      getLogsCalls += 1
      if (getLogsCalls === 1) throw new Error('The request took too long to respond')
      return []
    },
    readContract: async () => '0x0000000000000000000000000000000000000000',
  } as unknown as Parameters<typeof discoverVaultedTokens>[0]['client']
  const out = await discoverVaultedTokens({
    client,
    vaultAddress: VAULT,
    registry: REGISTRY,
    depositorAddress: OWNER,
    fromBlock: 0n,
  })
  assert.deepEqual(out, [])
  assert.ok(getLogsCalls >= 2, 'expected at least one retry on the first window')
})

test('discoverVaultedTokens exhausts the per-window budget on persistent getLogs throws and surfaces the error', async () => {
  let getLogsCalls = 0
  const client = {
    getBlockNumber: async () => 100n,
    getLogs: async () => {
      getLogsCalls += 1
      throw new Error('persistent getLogs timeout')
    },
    readContract: async () => '0x0000000000000000000000000000000000000000',
  } as unknown as Parameters<typeof discoverVaultedTokens>[0]['client']
  await assert.rejects(
    () => discoverVaultedTokens({
      client,
      vaultAddress: VAULT,
      registry: REGISTRY,
      depositorAddress: OWNER,
      fromBlock: 0n,
    }),
    (err: unknown) => err instanceof Error && /persistent getLogs timeout/.test(err.message),
  )
  assert.equal(getLogsCalls, 3)
})
