import test from 'node:test'
import assert from 'node:assert/strict'
import { custom, getAddress, parseTransaction, type Hex } from 'viem'
import { createLocalKeySender, createLocalKeySignAndTransaction } from '../../../src/identity/wallet/localKeyWallet.js'
import { prepareTransactionGasFee } from '../../../src/identity/wallet/browserWallet/gas.js'
import { operatorEnsSigner } from '../../../src/identity/manager/ens/signer.js'
import { assertVaultCanAcceptAgent } from '../../../src/identity/manager/custody/transactions.js'
import { createMainnetClient } from '../../../src/identity/ens/ensLookup.js'
import { readEthagentTextRecords } from '../../../src/identity/ens/ensLookup.js'
import { OPERATOR_KEY_ENV } from '../../../src/cli/operatorKey.js'
import type { VaultBuild } from '../../../src/identity/registry/vault.js'

const KEY = '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d' as const
const ACCOUNT = getAddress('0x70997970C51812dc3A010C7d01b50e0d17dc79C8')
const TO = getAddress('0x000000000000000000000000000000000000bEEF')

// A transport that answers the few calls a local-key send makes and records the rest.
function recordingTransport() {
  const requests: Array<{ method: string; params: unknown[] }> = []
  const transport = custom({
    async request({ method, params }: { method: string; params?: unknown[] }) {
      requests.push({ method, params: params ?? [] })
      if (method === 'eth_chainId') return '0x1'
      if (method === 'eth_getTransactionCount') return '0x7'
      if (method === 'eth_sendRawTransaction') return '0x' + 'ab'.repeat(32)
      throw new Error(`unexpected ${method}`)
    },
  })
  return { requests, transport }
}

test('the local-key sender broadcasts once with the prepared gas and fees', async () => {
  const { requests, transport } = recordingTransport()
  const sender = createLocalKeySender({ privateKey: KEY, chainId: 1, transport })
  assert.equal(sender.account, ACCOUNT)
  const { txHash } = await sender.send({ to: TO, data: '0x1234', gas: '0xf000', maxFeePerGas: '0x77359400', maxPriorityFeePerGas: '0x3b9aca00' })
  assert.equal(txHash, '0x' + 'ab'.repeat(32))
  const sends = requests.filter(item => item.method === 'eth_sendRawTransaction')
  assert.equal(sends.length, 1)
  assert.ok(!requests.some(item => item.method === 'eth_estimateGas' || item.method === 'eth_maxPriorityFeePerGas'))
  const tx = parseTransaction(sends[0]!.params[0] as Hex)
  assert.equal(tx.gas, 0xf000n)
  assert.equal(tx.maxFeePerGas, 0x77359400n)
  assert.equal(tx.maxPriorityFeePerGas, 0x3b9aca00n)
  assert.equal(tx.chainId, 1)
  assert.equal(tx.to?.toLowerCase(), TO.toLowerCase())
})

test('the operator ENS signer only signs on mainnet', () => {
  const { transport } = recordingTransport()
  assert.throws(() => operatorEnsSigner(createLocalKeySender({ privateKey: KEY, chainId: 8453, transport })), /Ethereum Mainnet/)
  assert.equal(operatorEnsSigner(createLocalKeySender({ privateKey: KEY, chainId: 1, transport })).account, ACCOUNT)
})

test('createLocalKeySignAndTransaction signs the challenge, prepares, and sends with the prepared fees', async () => {
  const { requests, transport } = recordingTransport()
  const run = createLocalKeySignAndTransaction({ privateKey: KEY, rpcUrl: 'https://rpc.example', chainId: 1, transport })
  const result = await run({
    chainId: 1,
    expectedAccount: ACCOUNT,
    messageForAccount: account => `restore access for ${account}`,
    prepareTransaction: async wallet => {
      assert.equal(wallet.account, ACCOUNT)
      assert.match(wallet.signature, /^0x[0-9a-f]{130}$/)
      return { to: TO, data: '0x', gas: '0x5208', maxFeePerGas: '0x2', maxPriorityFeePerGas: '0x1', prepared: { ok: true } }
    },
  })
  assert.equal(result.prepared.ok, true)
  assert.equal(result.message, `restore access for ${ACCOUNT}`)
  const raw = requests.find(item => item.method === 'eth_sendRawTransaction')!.params[0] as Hex
  assert.equal(parseTransaction(raw).gas, 0x5208n)
})

test('createLocalKeySignAndTransaction refuses a key that is not the expected operator', async () => {
  const { transport } = recordingTransport()
  const run = createLocalKeySignAndTransaction({ privateKey: KEY, rpcUrl: 'https://rpc.example', chainId: 1, transport })
  await assert.rejects(
    run({
      chainId: 1,
      expectedAccount: TO,
      message: 'x',
      prepareTransaction: async () => { throw new Error('must not prepare') },
    }),
    /not this agent's authorized operator wallet/,
  )
})

test('runOperatorSave exits 3 without a key and 2 with an invalid one', async () => {
  const { runOperatorSave } = await import('../../../src/cli/operatorSave.js')
  const write = process.stdout.write.bind(process.stdout)
  const previous = process.env[OPERATOR_KEY_ENV]
  process.stdout.write = (() => true) as typeof process.stdout.write
  try {
    delete process.env[OPERATOR_KEY_ENV]
    assert.equal(await runOperatorSave(['--json']), 3)
    process.env[OPERATOR_KEY_ENV] = '0x00'
    assert.equal(await runOperatorSave(['--json']), 2)
  } finally {
    process.stdout.write = write
    if (previous === undefined) delete process.env[OPERATOR_KEY_ENV]
    else process.env[OPERATOR_KEY_ENV] = previous
  }
})

test('the gas estimate looks again once per block past a not-yet-visible answer', async () => {
  let estimates = 0
  const pauses: number[] = []
  const prepared = await prepareTransactionGasFee({
    client: {
      estimateGas: async () => {
        estimates += 1
        if (estimates === 1) throw new Error('header not found')
        return 100_000n
      },
      estimateFeesPerGas: async () => ({ maxFeePerGas: 2n, maxPriorityFeePerGas: 1n }),
    } as never,
    account: ACCOUNT,
    to: TO,
    data: '0x',
    blockTimeMs: 12_000,
    pause: async ms => { pauses.push(ms) },
  })
  assert.equal(prepared.gas, '0x1d4c0')
  assert.deepEqual(pauses, [12_000])
})

test('the gas estimate surfaces a Vault refusal at once, by name', async () => {
  let estimates = 0
  await assert.rejects(
    prepareTransactionGasFee({
      client: {
        estimateGas: async () => {
          estimates += 1
          throw Object.assign(new Error('execution reverted'), { code: 3, data: '0x30cd7471' })
        },
        estimateFeesPerGas: async () => ({ maxFeePerGas: 2n, maxPriorityFeePerGas: 1n }),
      } as never,
      account: ACCOUNT,
      to: TO,
      data: '0x',
      pause: async () => { throw new Error('a revert must not wait') },
    }),
    /would be refused: only the wallet that deposited the token may do this \(NotOwner\)/,
  )
  assert.equal(estimates, 1)
})

const REGISTRY = getAddress('0x8004A169FB4a3325136EB29fA0ceB6D2e539a432')
const VAULT = getAddress('0x00000000000000000000000000000000000077ab')
const OWNER = getAddress('0x000000000000000000000000000000000000abcd')
const NO_HELD_AGENT: VaultBuild = { id: 'pre-release', label: 'pre-release build', runtimeHash: '0x' + '00'.repeat(32) as Hex, hasHeldAgent: false }

test('the deposit preflight reads agentOwner on a build without heldAgent() and simulates the deposit', async () => {
  const reads: string[] = []
  const simulations: Array<{ account: string; functionName: string; args: readonly unknown[] }> = []
  await assertVaultCanAcceptAgent({
    registry: { chainId: 8453, rpcUrl: 'https://mainnet.base.org', identityRegistryAddress: REGISTRY },
    vaultAddress: VAULT,
    agentId: 45744n,
    build: NO_HELD_AGENT,
    owner: OWNER,
    client: {
      readContract: async (call: { functionName: string }) => {
        reads.push(call.functionName)
        return '0x0000000000000000000000000000000000000000'
      },
      simulateContract: async (call: { account: string; functionName: string; args: readonly unknown[] }) => {
        simulations.push(call)
        return { result: undefined, request: {} }
      },
    } as never,
  })
  assert.deepEqual(reads, ['agentOwner'])
  assert.equal(simulations.length, 1)
  assert.equal(simulations[0]!.functionName, 'safeTransferFrom')
  assert.equal(simulations[0]!.account, OWNER)
  assert.deepEqual(simulations[0]!.args, [OWNER, VAULT, 45744n])
})

test('the deposit preflight names a refused deposit and never treats a failed read as accept', async () => {
  const registry = { chainId: 8453, rpcUrl: 'https://mainnet.base.org', identityRegistryAddress: REGISTRY }
  await assert.rejects(
    assertVaultCanAcceptAgent({
      registry, vaultAddress: VAULT, agentId: 1n, build: NO_HELD_AGENT, owner: OWNER,
      client: {
        readContract: async () => '0x0000000000000000000000000000000000000000',
        simulateContract: async () => { throw Object.assign(new Error('execution reverted'), { code: 3, data: '0x9667ffdf' }) },
      } as never,
    }),
    /refused: this Vault was deployed for a different registry or token \(UnexpectedToken\)/,
  )
  await assert.rejects(
    assertVaultCanAcceptAgent({
      registry, vaultAddress: VAULT, agentId: 1n, build: { ...NO_HELD_AGENT, hasHeldAgent: true }, owner: OWNER,
      client: {
        readContract: async () => { throw new Error('No RPC endpoint answered') },
        simulateContract: async () => ({ result: undefined, request: {} }),
      } as never,
    }),
    /No RPC endpoint answered/,
  )
})

test('the manager ENS client reads through the adaptive transport', () => {
  const client = createMainnetClient()
  assert.equal(client.transport.type, 'custom')
  assert.equal(client.chain?.id, 1)
})

test('an unreadable ENS text record is an error, not an empty record', async () => {
  await assert.rejects(
    readEthagentTextRecords('agent.example.eth', ['org.ethagent.token'], {
      publicClient: {
        readContract: async (call: { functionName: string }) => {
          if (call.functionName === 'resolver') return '0x0000000000000000000000000000000000001234'
          throw new Error('No RPC endpoint answered')
        },
      } as never,
    }),
    /No RPC endpoint answered/,
  )
})
