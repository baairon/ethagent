import test from 'node:test'
import assert from 'node:assert/strict'
import { encodeAbiParameters, encodeEventTopics, getAddress, parseAbiItem } from 'viem'
import {
  AgentTokenIdRequiredError,
  DEFAULT_ERC8004_IDENTITY_REGISTRY_ADDRESS,
  RegisterAgentPreflightError,
  SUPPORTED_ERC8004_CHAINS,
  cidFromUri,
  discoverOwnedAgentBackupByTokenId,
  discoverOwnedAgentBackupsAcrossSupportedNetworks,
  discoverOwnedAgentBackups,
  encodeRegisterAgent,
  erc8004ConfigForSupportedChain,
  loadAgentRegistration,
  normalizeErc8004RegistryConfig,
  parseEthagentBackupPointer,
  parseEthagentOperatorsPointer,
  parseEthagentPublicDiscoveryPointer,
  preflightRegisterAgent,
  registeredAgentFromReceipt,
  validateErc8004TokenOwner,
  withEthagentBackupPointer,
  withEthagentPointers,
} from '../../../src/identity/registry/erc8004.js'

const OWNER = getAddress('0x000000000000000000000000000000000000C01d')

test('cidFromUri accepts standard IPFS agent URIs', () => {
  assert.equal(cidFromUri('ipfs://bafy-agent'), 'bafy-agent')
  assert.equal(cidFromUri('ipfs://ipfs/bafy-agent'), 'bafy-agent')
  assert.equal(cidFromUri('https://example.test/agent.json'), undefined)
})

test('ethagent backup pointer is parsed from ERC-8004 registration metadata', () => {
  const pointer = parseEthagentBackupPointer({
    name: 'agent',
    'x-ethagent': {
      version: 1,
      agentAddress: '0x000000000000000000000000000000000000dEaD',
      backup: {
        cid: 'bafy-backup',
        envelopeVersion: 'ethagent-pq-backup-v1',
        createdAt: new Date(0).toISOString(),
      },
    },
  })

  assert.equal(pointer?.cid, 'bafy-backup')
  assert.equal(pointer?.envelopeVersion, 'ethagent-pq-backup-v1')
  assert.equal(pointer?.agentAddress, '0x000000000000000000000000000000000000dEaD')
})

test('withEthagentBackupPointer preserves registration fields', () => {
  const updated = withEthagentBackupPointer(
    { type: 'https://eips.ethereum.org/EIPS/eip-8004#registration-v1', name: 'agent' },
    {
      cid: 'bafy-backup',
      envelopeVersion: 'ethagent-pq-backup-v1',
      createdAt: new Date(0).toISOString(),
      agentAddress: '0x000000000000000000000000000000000000dEaD',
    },
    undefined,
    undefined,
    OWNER,
  )

  assert.equal(updated.name, 'agent')
  assert.equal((updated['x-ethagent'] as { backup: { cid: string } }).backup.cid, 'bafy-backup')
  assert.equal((updated['x-ethagent'] as { agentAddress: string }).agentAddress, OWNER)
})

test('ethagent backup pointer preserves dual-wallet transfer snapshot metadata', () => {
  const sender = getAddress('0x0000000000000000000000000000000000000A11')
  const receiver = getAddress('0x0000000000000000000000000000000000000B22')
  const updated = withEthagentPointers(
    { type: 'https://eips.ethereum.org/EIPS/eip-8004#registration-v1', name: 'agent' },
    {
      backup: {
        cid: 'bafy-transfer',
        envelopeVersion: 'ethagent-continuity-snapshot-v1',
        createdAt: new Date(0).toISOString(),
        transferSnapshot: {
          kind: 'dual-wallet',
          senderAddress: sender,
          receiverAddress: receiver,
          receiverHandle: 'agent.receiver.eth',
          slotCount: 2,
          createdAt: new Date(0).toISOString(),
        },
      },
      ownerAddress: OWNER,
    },
  )
  const ext = updated['x-ethagent'] as { backup: { transferSnapshot: { senderAddress: string; receiverAddress: string; receiverHandle: string; slotCount: number } } }
  const parsed = parseEthagentBackupPointer(updated)

  assert.equal(ext.backup.transferSnapshot.senderAddress, sender)
  assert.equal(ext.backup.transferSnapshot.receiverAddress, receiver)
  assert.equal(parsed?.transferSnapshot?.senderAddress, sender)
  assert.equal(parsed?.transferSnapshot?.receiverAddress, receiver)
  assert.equal(parsed?.transferSnapshot?.receiverHandle, 'agent.receiver.eth')
  assert.equal(parsed?.transferSnapshot?.slotCount, 2)
})

test('ethagent backup pointer removes legacy transfer handoff metadata on republish', () => {
  const updated = withEthagentPointers(
    {
      type: 'https://eips.ethereum.org/EIPS/eip-8004#registration-v1',
      name: 'agent',
      'x-ethagent': {
        version: 1,
        transfer: { cid: 'bafy-transfer' },
        handoff: { cid: 'bafy-handoff' },
      },
    },
    {
      backup: {
        cid: 'bafy-backup',
        envelopeVersion: 'ethagent-continuity-snapshot-v1',
        createdAt: new Date(1).toISOString(),
      },
      ownerAddress: OWNER,
    },
  )
  const ext = updated['x-ethagent'] as { backup?: { cid: string }; transfer?: unknown; handoff?: unknown }

  assert.equal(ext.backup?.cid, 'bafy-backup')
  assert.equal(ext.transfer, undefined)
  assert.equal(ext.handoff, undefined)
})

test('ethagent metadata helpers require explicit owner address', () => {
  // @ts-expect-error ownerAddress is intentionally required to prevent stale x402 wallets.
  const compileCheck = () => withEthagentPointers(null, { backup: { cid: 'bafy-backup' } })
  void compileCheck
  assert.throws(
    () => withEthagentPointers(null, { backup: { cid: 'bafy-backup' } } as any),
    /requires ownerAddress/,
  )
  assert.throws(
    () => (withEthagentBackupPointer as any)(null, { cid: 'bafy-backup' }, undefined, undefined),
    /requires ownerAddress/,
  )
})

test('ethagent public discovery pointers are written to registration metadata and services', () => {
  const updated = withEthagentBackupPointer(
    { type: 'https://eips.ethereum.org/EIPS/eip-8004#registration-v1', name: 'agent' },
    {
      cid: 'bafy-private-snapshot',
      envelopeVersion: 'ethagent-continuity-snapshot-v1',
      createdAt: new Date(0).toISOString(),
    },
    {
      agentCardCid: 'bafy-card',
      updatedAt: new Date(0).toISOString(),
    },
    {
      chainId: 8453,
      identityRegistryAddress: '0x8004A169FB4a3325136EB29fA0ceB6D2e539a432',
      agentId: '7',
    },
    OWNER,
  )
  const pointer = parseEthagentPublicDiscoveryPointer(updated)
  const ext = updated['x-ethagent'] as {
    agentCard: { cid: string; format: string }
    publicSkills?: unknown
  }
  const services = updated.services as Array<{ type?: string; name?: string; endpoint: string; url?: string; version?: string }>
  const registrations = updated.registrations as Array<{ agentId: number; agentRegistry: string }>

  assert.equal(pointer?.agentCardCid, 'bafy-card')
  assert.equal(ext.agentCard.format, 'application/json')
  assert.equal(ext.publicSkills, undefined)
  assert.ok(services.some(service => service.name === 'agentWallet' && service.endpoint === `eip155:8453:${OWNER}`))
  assert.equal(services.filter(service => service.name === 'agentWallet').length, 1)
  assert.ok(services.some(service =>
    service.type === 'A2A'
    && service.name === 'agent-card'
    && service.version === '0.3.0'
    && service.endpoint === 'ipfs://bafy-card'
    && service.url === 'ipfs://bafy-card',
  ))
  assert.equal(services.some(service => service.name === 'public-skills'), false)
  assert.ok(services.every(service => typeof service.endpoint === 'string' && service.endpoint.length > 0))
  assert.equal(registrations.length, 1)
  assert.equal(registrations[0]?.agentId, 7)
  assert.equal(registrations[0]?.agentRegistry, 'eip155:8453:0x8004A169FB4a3325136EB29fA0ceB6D2e539a432')
  assert.equal(JSON.stringify(updated).includes('SOUL.md'), false)
  assert.equal(JSON.stringify(updated).includes('MEMORY.md'), false)
})

test('parseEthagentPublicDiscoveryPointer falls back to legacy publicSkills.cid when agentCard is absent', () => {
  const legacy = parseEthagentPublicDiscoveryPointer({
    name: 'agent',
    'x-ethagent': {
      publicSkills: { cid: 'bafy-legacy-skills', updatedAt: '2026-04-21T00:00:00.000Z' },
    },
  })
  assert.equal(legacy?.agentCardCid, 'bafy-legacy-skills')
  assert.equal(legacy?.updatedAt, '2026-04-21T00:00:00.000Z')

  const newShape = parseEthagentPublicDiscoveryPointer({
    name: 'agent',
    'x-ethagent': {
      agentCard: { cid: 'bafy-card', updatedAt: '2026-04-21T00:00:00.000Z' },
    },
  })
  assert.equal(newShape?.agentCardCid, 'bafy-card')

  const both = parseEthagentPublicDiscoveryPointer({
    name: 'agent',
    'x-ethagent': {
      publicSkills: { cid: 'bafy-legacy-skills' },
      agentCard: { cid: 'bafy-card-new' },
    },
  })
  assert.equal(both?.agentCardCid, 'bafy-card-new', 'agentCard takes precedence over legacy publicSkills')

  const neither = parseEthagentPublicDiscoveryPointer({ name: 'agent', 'x-ethagent': {} })
  assert.equal(neither, null)
})

test('ethagent operators pointer is written and parsed from ERC-8004 metadata', () => {
  const updated = withEthagentPointers(
    { type: 'https://eips.ethereum.org/EIPS/eip-8004#registration-v1', name: 'agent' },
    {
      operators: {
        ownerAddress: '0x000000000000000000000000000000000000c01d',
        activeOperatorAddress: '0x0000000000000000000000000000000000000A11',
        ensName: 'agent.example.eth',
        approvedOperatorWallets: [
          {
            address: '0x0000000000000000000000000000000000000A11',
            challenge: 'proof challenge',
            verifiedAt: '2026-05-04T00:00:00.000Z',
          },
          { address: '0x0000000000000000000000000000000000000B22' },
        ],
      },
      ownerAddress: OWNER,
    },
  )
  const parsed = parseEthagentOperatorsPointer(updated)
  const ext = updated['x-ethagent'] as { operators: { approvedOperatorWallets: Array<{ address: string }> } }

  assert.equal(parsed?.ownerAddress, getAddress('0x000000000000000000000000000000000000c01d'))
  assert.equal(parsed?.activeOperatorAddress, getAddress('0x0000000000000000000000000000000000000A11'))
  assert.equal(parsed?.ensName, 'agent.example.eth')
  assert.deepEqual(parsed?.approvedOperatorWallets.map(item => item.address), [
    getAddress('0x0000000000000000000000000000000000000A11'),
    getAddress('0x0000000000000000000000000000000000000B22'),
  ])
  assert.equal(parsed?.approvedOperatorWallets[0]?.verifiedAt, '2026-05-04T00:00:00.000Z')
  assert.equal(ext.operators.approvedOperatorWallets.length, 2)
})

test('ENSIP-25 + ERC-8004 round-trip: ENS key chain matches metadata registration chain', () => {
  const ensName = 'agent.example.eth'
  const baseChainId = 8453
  const agentId = '45744'
  const ensKey = `agent-registration[0x00010000022105148004a169fb4a3325136eb29fa0ceb6d2e539a432][${agentId}]`

  const updated = withEthagentPointers(
    { type: 'https://eips.ethereum.org/EIPS/eip-8004#registration-v1', name: 'agent' },
    {
      backup: {
        cid: 'bafy-snapshot',
        envelopeVersion: 'ethagent-continuity-snapshot-v1',
        createdAt: new Date(0).toISOString(),
      },
      publicDiscovery: { agentCardCid: 'bafy-card', updatedAt: new Date(0).toISOString() },
      registration: {
        chainId: baseChainId,
        identityRegistryAddress: '0x8004A169FB4a3325136EB29fA0ceB6D2e539a432',
        agentId,
      },
      operators: {
        ownerAddress: OWNER,
        approvedOperatorWallets: [],
        ensName,
      },
      ensName,
      ownerAddress: OWNER,
    },
  )

  const parsedOps = parseEthagentOperatorsPointer(updated)
  const registrations = updated.registrations as Array<{ agentId: number | string; agentRegistry: string }>
  const services = updated.services as Array<{ name?: string; endpoint?: string; version?: string }>

  assert.equal(parsedOps?.ensName, ensName, 'metadata must name the ENS back')
  assert.ok(ensKey.includes(`][${agentId}]`), 'ENSIP-25 key carries the same agentId')
  assert.ok(ensKey.includes('00010000022105'), 'ENSIP-25 key encodes Base chainId (0x2105 = 8453)')
  assert.equal(
    registrations[0]?.agentRegistry,
    `eip155:${baseChainId}:0x8004A169FB4a3325136EB29fA0ceB6D2e539a432`,
    'metadata registrations[] points to the same (chain, registry)',
  )
  assert.equal(String(registrations[0]?.agentId), agentId, 'metadata registrations[] carries the same agentId')
  assert.ok(
    services.some(s => s.name === 'ENS' && s.endpoint === ensName && s.version === 'v1'),
    'ENS service entry must appear in services[] for ENSIP-25 round-trip discovery',
  )
})

test('ethagent operators pointer ignores legacy signature field on read', () => {
  const updated = withEthagentPointers(
    { type: 'https://eips.ethereum.org/EIPS/eip-8004#registration-v1', name: 'agent' },
    {
      operators: {
        ownerAddress: '0x000000000000000000000000000000000000c01d',
        activeOperatorAddress: '0x0000000000000000000000000000000000000A11',
        approvedOperatorWallets: [
          { address: '0x0000000000000000000000000000000000000A11' },
        ],
      },
      ownerAddress: OWNER,
    },
  )
  const ext = updated['x-ethagent'] as { operators: { approvedOperatorWallets: Array<Record<string, unknown>> } }
  ext.operators.approvedOperatorWallets[0]!.signature = `0x${'aa'.repeat(65)}`
  const parsed = parseEthagentOperatorsPointer(updated)
  assert.equal(parsed?.approvedOperatorWallets[0]?.address, getAddress('0x0000000000000000000000000000000000000A11'))
  assert.equal((parsed?.approvedOperatorWallets[0] as Record<string, unknown> | undefined)?.signature, undefined)
})

test('ethagent x402 wallet pointer always uses current owner, not operator wallet', () => {
  const owner = getAddress('0x000000000000000000000000000000000000c01d')
  const operator = getAddress('0x0000000000000000000000000000000000000A11')
  const updated = withEthagentPointers(
    {
      type: 'https://eips.ethereum.org/EIPS/eip-8004#registration-v1',
      name: 'agent',
      'x-ethagent': {
        version: 1,
        agentAddress: operator,
        x402: { walletAddress: operator, network: 'eip155:1' },
      },
    },
    {
      ownerAddress: owner,
      operators: {
        ownerAddress: owner,
        activeOperatorAddress: operator,
        approvedOperatorWallets: [{ address: operator }],
      },
    },
  )
  const ext = updated['x-ethagent'] as {
    agentAddress: string
    x402: { walletAddress: string; network: string }
    operators: { activeOperatorAddress: string }
  }

  assert.equal(ext.agentAddress, owner)
  assert.equal(ext.x402.walletAddress, owner)
  assert.equal(ext.x402.network, 'eip155:1')
  assert.equal(ext.operators.activeOperatorAddress, operator)
})

test('registration metadata preserves legacy string agent IDs when they are not safely numeric', () => {
  const updated = withEthagentBackupPointer(
    { type: 'https://eips.ethereum.org/EIPS/eip-8004#registration-v1', name: 'agent' },
    { cid: 'bafy-private-snapshot', envelopeVersion: 'ethagent-continuity-snapshot-v1' },
    undefined,
    {
      chainId: 8453,
      identityRegistryAddress: '0x8004A169FB4a3325136EB29fA0ceB6D2e539a432',
      agentId: '9007199254740993',
    },
    OWNER,
  )
  const registrations = updated.registrations as Array<{ agentId: string; agentRegistry: string }>

  assert.equal(registrations[0]?.agentId, '9007199254740993')
})

test('ethagent operators pointer accepts legacy string wallet arrays', () => {
  const parsed = parseEthagentOperatorsPointer({
    name: 'agent',
    'x-ethagent': {
      operators: {
        approvedOperatorWallets: [
          '0x0000000000000000000000000000000000000A11',
          'not-an-address',
          '0x0000000000000000000000000000000000000B22',
        ],
        activeOperatorAddress: '0x0000000000000000000000000000000000000A11',
      },
    },
  })

  assert.deepEqual(parsed?.approvedOperatorWallets.map(item => item.address), [
    getAddress('0x0000000000000000000000000000000000000A11'),
    getAddress('0x0000000000000000000000000000000000000B22'),
  ])
})

test('registration metadata replaces managed history with current state on republish', () => {
  const first = withEthagentBackupPointer(
    {
      type: 'https://eips.ethereum.org/EIPS/eip-8004#registration-v1',
      name: 'agent',
      services: [
        { type: 'website', name: 'docs', endpoint: 'https://example.com', url: 'https://example.com' },
        { name: 'agentWallet', endpoint: 'eip155:8453:0x000000000000000000000000000000000000bEEF' },
      ],
      registrations: [{ agentId: '1', agentRegistry: 'eip155:1:0x1111111111111111111111111111111111111111' }],
    },
    { cid: 'bafy-1', envelopeVersion: 'ethagent-continuity-snapshot-v1', createdAt: new Date(0).toISOString() },
    { agentCardCid: 'bafy-card-1', updatedAt: new Date(0).toISOString() },
    { chainId: 8453, identityRegistryAddress: '0x8004A169FB4a3325136EB29fA0ceB6D2e539a432', agentId: '7' },
    OWNER,
  )
  const second = withEthagentBackupPointer(
    first,
    {
      cid: 'bafy-2',
      envelopeVersion: 'ethagent-continuity-snapshot-v1',
      createdAt: new Date(1).toISOString(),
      pastBackups: [{ cid: 'bafy-1', createdAt: new Date(0).toISOString() }],
    },
    { agentCardCid: 'bafy-card-2', updatedAt: new Date(1).toISOString() },
    { chainId: 8453, identityRegistryAddress: '0x8004A169FB4a3325136EB29fA0ceB6D2e539a432', agentId: '8' },
    OWNER,
  )
  const ext = second['x-ethagent'] as { backup: { cid: string; pastBackups?: unknown } }
  const services = second.services as Array<{ type?: string; name?: string; endpoint: string }>
  const registrations = second.registrations as Array<{ agentId: number; agentRegistry: string }>

  assert.equal(ext.backup.cid, 'bafy-2')
  assert.equal(ext.backup.pastBackups, undefined)
  assert.ok(services.some(service => service.type === 'website' && service.endpoint === 'https://example.com'))
  assert.equal(services.filter(service => service.name === 'agentWallet').length, 1)
  assert.ok(services.some(service => service.name === 'agentWallet' && service.endpoint === `eip155:8453:${OWNER}`))
  assert.equal(services.some(service => service.endpoint === 'eip155:8453:0x000000000000000000000000000000000000bEEF'), false)
  assert.equal(services.some(service => service.endpoint === 'ipfs://bafy-card-1'), false)
  assert.equal(services.some(service => service.name === 'public-skills'), false)
  assert.ok(services.some(service => service.type === 'A2A' && service.name === 'agent-card' && service.endpoint === 'ipfs://bafy-card-2'))
  assert.equal(registrations.length, 1)
  assert.equal(registrations[0]?.agentId, 8)
  assert.equal(registrations[0]?.agentRegistry, 'eip155:8453:0x8004A169FB4a3325136EB29fA0ceB6D2e539a432')
})

test('encodeRegisterAgent encodes ERC-8004 register(string)', () => {
  assert.equal(
    encodeRegisterAgent({ agentURI: 'ipfs://bafy-agent' }).slice(0, 10),
    '0xf2c298be',
  )
})

test('preflightRegisterAgent estimates register cost before wallet submission', async () => {
  let estimatedData = ''
  const preflight = await preflightRegisterAgent({
    chainId: 1,
    rpcUrl: 'https://example.test',
    identityRegistryAddress: DEFAULT_ERC8004_IDENTITY_REGISTRY_ADDRESS,
    ownerAddress: '0x000000000000000000000000000000000000dEaD',
    agentURI: 'ipfs://bafy-agent',
    publicClient: {
      estimateGas: async args => {
        estimatedData = args.data
        return 100_000n
      },
      getGasPrice: async () => 10n,
      getBalance: async () => 2_000_000n,
    },
  })

  assert.equal(estimatedData.slice(0, 10), '0xf2c298be')
  assert.equal(preflight.estimatedCostWei, 1_000_000n)
  assert.equal(preflight.requiredBalanceWei, 1_200_000n)
})

test('preflightRegisterAgent reports insufficient funds clearly', async () => {
  await assert.rejects(() => preflightRegisterAgent({
    chainId: 1,
    rpcUrl: 'https://example.test',
    identityRegistryAddress: DEFAULT_ERC8004_IDENTITY_REGISTRY_ADDRESS,
    ownerAddress: '0x000000000000000000000000000000000000dEaD',
    agentURI: 'ipfs://bafy-agent',
    publicClient: {
      estimateGas: async () => 100_000n,
      getGasPrice: async () => 10n,
      getBalance: async () => 1n,
    },
  }), (err: unknown) => {
    assert.ok(err instanceof RegisterAgentPreflightError)
    assert.equal(err.code, 'insufficient-funds')
    assert.equal(err.title, 'Not Enough ETH')
    assert.match(err.detail, /Need ~.* ETH\. Wallet has .* ETH\./)
    assert.equal(err.hint, 'Add ETH to this wallet, then try again.')
    return true
  })
})

test('preflightRegisterAgent reports simulation reverts before sending', async () => {
  await assert.rejects(() => preflightRegisterAgent({
    chainId: 1,
    rpcUrl: 'https://example.test',
    identityRegistryAddress: DEFAULT_ERC8004_IDENTITY_REGISTRY_ADDRESS,
    ownerAddress: '0x000000000000000000000000000000000000dEaD',
    agentURI: 'ipfs://bafy-agent',
    publicClient: {
      estimateGas: async () => { throw new Error('execution reverted: bad agentURI') },
      getGasPrice: async () => 10n,
      getBalance: async () => 2_000_000n,
    },
  }), (err: unknown) => {
    assert.ok(err instanceof RegisterAgentPreflightError)
    assert.equal(err.code, 'simulation-failed')
    assert.equal(err.title, 'Registration Blocked')
    assert.equal(err.detail, 'execution reverted: bad agentURI')
    assert.equal(err.hint, 'No transaction was sent.')
    return true
  })
})

test('registeredAgentFromReceipt decodes Registered event from receipt logs', () => {
  const event = parseAbiItem('event Registered(uint256 indexed agentId, address indexed owner, string agentURI)')
  const registry = '0x8004A169FB4a3325136EB29fA0ceB6D2e539a432'
  const owner = '0x000000000000000000000000000000000000dEaD'
  const agentURI = 'ipfs://bafy-agent'
  const topics = encodeEventTopics({
    abi: [event],
    eventName: 'Registered',
    args: { agentId: 42n, owner },
  })
  const decoded = registeredAgentFromReceipt({
    identityRegistryAddress: registry,
    ownerAddress: owner,
    logs: [{
      address: registry,
      topics: topics as `0x${string}`[],
      data: encodeAbiParameters([{ type: 'string' }], [agentURI]),
    }],
  })

  assert.equal(decoded.agentId, 42n)
  assert.equal(decoded.agentURI, agentURI)
  assert.equal(decoded.owner, owner)
})

test('loadAgentRegistration parses data URI JSON', async () => {
  const raw = JSON.stringify({ name: 'data-agent' })
  const encoded = Buffer.from(raw, 'utf8').toString('base64')
  const loaded = await loadAgentRegistration(`data:application/json;base64,${encoded}`)

  assert.equal(loaded.registration.name, 'data-agent')
})

test('discoverOwnedAgentBackups uses the curated start block when fromBlock is omitted', async () => {
  let scannedFromBlock: bigint | undefined
  await assert.rejects(() => discoverOwnedAgentBackups({
    chainId: 8453,
    rpcUrl: 'https://mainnet.base.org',
    identityRegistryAddress: DEFAULT_ERC8004_IDENTITY_REGISTRY_ADDRESS,
    ownerHandle: '0x000000000000000000000000000000000000dEaD',
    publicClient: {
      getBlockNumber: async () => 41_663_783n,
      getLogs: async (args: { fromBlock?: bigint; event?: { name?: string }; args?: Record<string, unknown> }) => {
        scannedFromBlock = args.fromBlock
        assert.equal(args.event?.name, 'Transfer')
        assert.equal(args.args?.to, '0x000000000000000000000000000000000000dEaD')
        return []
      },
      readContract: async (call: { functionName: string }) => {
        if (call.functionName === 'balanceOf') return 1n
        throw new Error(`unexpected read: ${call.functionName}`)
      },
      getBytecode: async () => {
        throw new Error('historical getCode should not be required for discovery')
      },
    } as any,
  }), AgentTokenIdRequiredError)

  assert.equal(scannedFromBlock, 41_663_783n)
})

test('discoverOwnedAgentBackups skips log scans when balance is zero', async () => {
  const candidates = await discoverOwnedAgentBackups({
    chainId: 8453,
    rpcUrl: 'https://mainnet.base.org',
    identityRegistryAddress: DEFAULT_ERC8004_IDENTITY_REGISTRY_ADDRESS,
    ownerHandle: '0x000000000000000000000000000000000000dEaD',
    publicClient: {
      getLogs: async () => {
        throw new Error('logs should not be scanned for an empty wallet')
      },
      readContract: async (call: { functionName: string }) => {
        if (call.functionName === 'balanceOf') return 0n
        throw new Error(`unexpected read: ${call.functionName}`)
      },
    } as any,
  })

  assert.deepEqual(candidates, [])
})

test('discoverOwnedAgentBackups verifies ownership before loading agent metadata', async () => {
  const owner = '0x000000000000000000000000000000000000dEaD'
  const other = '0x000000000000000000000000000000000000bEEF'
  let tokenUriReads = 0
  await assert.rejects(() => discoverOwnedAgentBackups({
    chainId: 8453,
    rpcUrl: 'https://base.publicnode.com',
    identityRegistryAddress: DEFAULT_ERC8004_IDENTITY_REGISTRY_ADDRESS,
    ownerHandle: owner,
    publicClient: {
      getBlockNumber: async () => 41_663_783n,
      getLogs: async () => [{ args: { tokenId: 7n } }],
      readContract: async (call: { functionName: string }) => {
        if (call.functionName === 'balanceOf') return 1n
        if (call.functionName === 'tokenOfOwnerByIndex') throw new Error('enumerable unsupported')
        if (call.functionName === 'ownerOf') return other
        tokenUriReads++
        return agentDataUri('ignored')
      },
    } as any,
  }), AgentTokenIdRequiredError)

  assert.equal(tokenUriReads, 0)
})

test('discoverOwnedAgentBackups returns transfer-owned agents with recoverable state', async () => {
  const owner = '0x000000000000000000000000000000000000dEaD'
  const candidates = await discoverOwnedAgentBackups({
    chainId: 8453,
    rpcUrl: 'https://base.publicnode.com',
    identityRegistryAddress: DEFAULT_ERC8004_IDENTITY_REGISTRY_ADDRESS,
    ownerHandle: owner,
    publicClient: {
      getBlockNumber: async () => 41_663_783n,
      getLogs: async () => [{ args: { tokenId: 9n } }],
      readContract: async (call: { functionName: string }) => {
        if (call.functionName === 'balanceOf') return 1n
        if (call.functionName === 'tokenOfOwnerByIndex') throw new Error('enumerable unsupported')
        if (call.functionName === 'ownerOf') return owner
        if (call.functionName === 'tokenURI') return agentDataUri('bafy-state-base', 'base agent')
        throw new Error(`unexpected read: ${call.functionName}`)
      },
    } as any,
  })

  assert.equal(candidates.length, 1)
  assert.equal(candidates[0]?.agentId, 9n)
  assert.equal(candidates[0]?.name, 'base agent')
  assert.equal(candidates[0]?.backup?.cid, 'bafy-state-base')
})

test('discoverOwnedAgentBackups uses enumerable owner indexes before log scans', async () => {
  const owner = '0x000000000000000000000000000000000000dEaD'
  const candidates = await discoverOwnedAgentBackups({
    chainId: 8453,
    rpcUrl: 'https://base.publicnode.com',
    identityRegistryAddress: DEFAULT_ERC8004_IDENTITY_REGISTRY_ADDRESS,
    ownerHandle: owner,
    publicClient: {
      getLogs: async () => {
        throw new Error('logs should not be scanned when enumerable lookup works')
      },
      readContract: async (call: { functionName: string; args: unknown[] }) => {
        if (call.functionName === 'balanceOf') return 1n
        if (call.functionName === 'tokenOfOwnerByIndex') {
          assert.equal(call.args[0], owner)
          assert.equal(call.args[1], 0n)
          return 11n
        }
        if (call.functionName === 'ownerOf') return owner
        if (call.functionName === 'tokenURI') return agentDataUri('bafy-enumerable', 'enumerable agent')
        throw new Error(`unexpected read: ${call.functionName}`)
      },
    } as any,
  })

  assert.equal(candidates.length, 1)
  assert.equal(candidates[0]?.agentId, 11n)
  assert.equal(candidates[0]?.backup?.cid, 'bafy-enumerable')
})

test('discoverOwnedAgentBackups reports incomplete ownership enumeration when positive balance logs time out', async () => {
  const owner = '0x000000000000000000000000000000000000dEaD'
  await assert.rejects(() => discoverOwnedAgentBackups({
    chainId: 8453,
    rpcUrl: 'https://mainnet.base.org',
    identityRegistryAddress: DEFAULT_ERC8004_IDENTITY_REGISTRY_ADDRESS,
    ownerHandle: owner,
    publicClient: {
      getBlockNumber: async () => 41_663_783n,
      getLogs: async () => {
        throw new Error('request timed out')
      },
      readContract: async (call: { functionName: string }) => {
        if (call.functionName === 'balanceOf') return 1n
        if (call.functionName === 'tokenOfOwnerByIndex') throw new Error('enumerable unsupported')
        throw new Error(`unexpected read: ${call.functionName}`)
      },
    } as any,
  }), (err: unknown) => {
    assert.ok(err instanceof AgentTokenIdRequiredError)
    assert.match(err.message, /Automatic base token ownership lookup could not enumerate this wallet's ERC-8004 token IDs\./)
    assert.doesNotMatch(err.message, /URL:/)
    return true
  })
})

test('discoverOwnedAgentBackupByTokenId validates ownership without logs', async () => {
  const owner = '0x000000000000000000000000000000000000dEaD'
  const candidate = await discoverOwnedAgentBackupByTokenId({
    chainId: 8453,
    rpcUrl: 'https://mainnet.base.org',
    identityRegistryAddress: DEFAULT_ERC8004_IDENTITY_REGISTRY_ADDRESS,
    ownerHandle: owner,
    tokenId: 45_744n,
    publicClient: {
      getLogs: async () => {
        throw new Error('manual token lookup should not scan logs')
      },
      readContract: async (call: { functionName: string }) => {
        if (call.functionName === 'ownerOf') return owner
        if (call.functionName === 'tokenURI') return agentDataUri('bafy-manual', 'manual agent')
        throw new Error(`unexpected read: ${call.functionName}`)
      },
    } as any,
  })

  assert.equal(candidate.agentId, 45_744n)
  assert.equal(candidate.backup?.cid, 'bafy-manual')
})

test('validateErc8004TokenOwner treats a vault owner with an empty slot as settling, not unlinked', async () => {
  const owner = getAddress('0x000000000000000000000000000000000000dEaD')
  const vault = getAddress('0x00000000000000000000000000000000000077ab')
  const result = await validateErc8004TokenOwner({
    chainId: 8453,
    rpcUrl: 'https://base.example',
    identityRegistryAddress: DEFAULT_ERC8004_IDENTITY_REGISTRY_ADDRESS,
    agentId: 45_744n,
    expectedOwner: owner,
    operatorVaults: { '8453': vault },
    publicClient: {
      readContract: async (call: { functionName: string }) => {
        if (call.functionName === 'ownerOf') return vault
        if (call.functionName === 'agentOwner') return '0x0000000000000000000000000000000000000000'
        throw new Error(`unexpected read: ${call.functionName}`)
      },
    } as any,
  })

  assert.equal(result.ok, false)
  if (!result.ok) {
    assert.equal(result.reason, 'token-owner-lookup-failed')
    assert.equal(result.ownerAddress, undefined)
    assert.match(result.detail, /vault record is empty/i)
  }
})

test('validateErc8004TokenOwner accepts the actual token owner as a Vault without per-chain config', async () => {
  const owner = getAddress('0x000000000000000000000000000000000000dEaD')
  const vault = getAddress('0x00000000000000000000000000000000000077ab')
  const result = await validateErc8004TokenOwner({
    chainId: 8453,
    rpcUrl: 'https://base.example',
    identityRegistryAddress: DEFAULT_ERC8004_IDENTITY_REGISTRY_ADDRESS,
    agentId: 45_744n,
    expectedOwner: owner,
    publicClient: {
      readContract: async (call: { functionName: string }) => {
        if (call.functionName === 'ownerOf') return vault
        if (call.functionName === 'agentOwner') return owner
        throw new Error(`unexpected read: ${call.functionName}`)
      },
    } as any,
  })

  assert.deepEqual(result, { ok: true, ownerAddress: owner })
})

test('discoverOwnedAgentBackupByTokenId accepts a operator wallet', async () => {
  const owner = getAddress('0x000000000000000000000000000000000000c01d')
  const operator = getAddress('0x0000000000000000000000000000000000000A11')
  const candidate = await discoverOwnedAgentBackupByTokenId({
    chainId: 8453,
    rpcUrl: 'https://mainnet.base.org',
    identityRegistryAddress: DEFAULT_ERC8004_IDENTITY_REGISTRY_ADDRESS,
    ownerHandle: operator,
    tokenId: 45_744n,
    publicClient: {
      getLogs: async () => {
        throw new Error('manual token lookup should not scan logs')
      },
      readContract: async (call: { functionName: string }) => {
        if (call.functionName === 'ownerOf') return owner
        if (call.functionName === 'tokenURI') {
          return agentDataUri('bafy-operator-wallet', 'operator wallet agent', {
            ownerAddress: owner,
            activeOperatorAddress: operator,
            approvedOperatorWallets: [{ address: operator }],
          })
        }
        throw new Error(`unexpected read: ${call.functionName}`)
      },
    } as any,
  })

  assert.equal(candidate.agentId, 45_744n)
  assert.equal(candidate.ownerAddress, owner)
  assert.equal(candidate.backup?.cid, 'bafy-operator-wallet')
  assert.deepEqual(candidate.operators?.approvedOperatorWallets.map(item => item.address), [operator])
})

test('discoverOwnedAgentBackupByTokenId rejects an unlisted operator wallet', async () => {
  const owner = getAddress('0x000000000000000000000000000000000000c01d')
  const operator = getAddress('0x0000000000000000000000000000000000000A11')
  const other = getAddress('0x0000000000000000000000000000000000000B22')
  await assert.rejects(() => discoverOwnedAgentBackupByTokenId({
    chainId: 8453,
    rpcUrl: 'https://mainnet.base.org',
    identityRegistryAddress: DEFAULT_ERC8004_IDENTITY_REGISTRY_ADDRESS,
    ownerHandle: operator,
    tokenId: 45_744n,
    publicClient: {
      readContract: async (call: { functionName: string }) => {
        if (call.functionName === 'ownerOf') return owner
        if (call.functionName === 'tokenURI') {
          return agentDataUri('bafy-unlinked', 'unlisted operator wallet agent', {
            ownerAddress: owner,
            activeOperatorAddress: other,
            approvedOperatorWallets: [{ address: other }],
          })
        }
        throw new Error(`unexpected read: ${call.functionName}`)
      },
    } as any,
  }), /operator wallet/)
})

test('discoverOwnedAgentBackupsAcrossSupportedNetworks returns candidates from multiple networks', async () => {
  const owner = '0x000000000000000000000000000000000000dEaD'
  const candidates = await discoverOwnedAgentBackupsAcrossSupportedNetworks({
    ownerHandle: owner,
    publicClients: {
      1: ownedTokenClient(owner, 1n, 'bafy-mainnet', 'mainnet agent'),
      42161: emptyLookupClient(),
      8453: ownedTokenClient(owner, 2n, 'bafy-base', 'base agent'),
      10: emptyLookupClient(),
      137: emptyLookupClient(),
    },
  })

  assert.deepEqual(candidates.map(candidate => candidate.chainId), [1, 8453])
  assert.deepEqual(candidates.map(candidate => candidate.backup?.cid), ['bafy-mainnet', 'bafy-base'])
})

test('discoverOwnedAgentBackupsAcrossSupportedNetworks ignores a failed network when another succeeds', async () => {
  const owner = '0x000000000000000000000000000000000000dEaD'
  const candidates = await discoverOwnedAgentBackupsAcrossSupportedNetworks({
    ownerHandle: owner,
    publicClients: {
      1: failingLookupClient(),
      42161: emptyLookupClient(),
      8453: ownedTokenClient(owner, 3n, 'bafy-base', 'base agent'),
      10: emptyLookupClient(),
      137: emptyLookupClient(),
    },
  })

  assert.equal(candidates.length, 1)
  assert.equal(candidates[0]?.chainId, 8453)
})

test('discoverOwnedAgentBackupsAcrossSupportedNetworks reports when all networks fail', async () => {
  const owner = '0x000000000000000000000000000000000000dEaD'
  await assert.rejects(() => discoverOwnedAgentBackupsAcrossSupportedNetworks({
    ownerHandle: owner,
    publicClients: {
      1: failingLookupClient(),
      42161: failingLookupClient(),
      8453: failingLookupClient(),
      10: failingLookupClient(),
      137: failingLookupClient(),
    },
  }), /lookup failed on all supported networks/)
})

test('ERC-8004 config defaults to Ethereum mainnet registry', () => {
  const config = normalizeErc8004RegistryConfig({})

  assert.equal(config.chainId, 1)
  assert.equal(config.identityRegistryAddress, DEFAULT_ERC8004_IDENTITY_REGISTRY_ADDRESS)
})

test('mainnet entry in the curated chain list still resolves with the default registry', () => {
  const mainnetEntry = SUPPORTED_ERC8004_CHAINS.find(c => c.chainId === 1)
  assert.ok(mainnetEntry, 'mainnet entry must be present')
  assert.equal(mainnetEntry?.kind, 'mainnet')
  assert.equal(mainnetEntry?.name, 'Ethereum Mainnet')
  assert.equal(erc8004ConfigForSupportedChain(1).chainId, 1)
  assert.throws(() => erc8004ConfigForSupportedChain(99999), /unsupported ERC-8004 chain id/i)
})

function agentDataUri(cid: string, name = 'agent', operators?: Record<string, unknown>): string {
  return `data:application/json,${encodeURIComponent(JSON.stringify({
    name,
    'x-ethagent': {
      backup: {
        cid,
        envelopeVersion: 'ethagent-state-backup-v1',
        createdAt: new Date(0).toISOString(),
      },
      ...(operators ? { operators } : {}),
    },
  }))}`
}

function emptyLookupClient(): any {
  return {
    getBlockNumber: async () => 500_000_000n,
    getLogs: async () => [],
    readContract: async (call: { functionName: string }) => {
      if (call.functionName === 'balanceOf') return 0n
      throw new Error(`unexpected empty client read: ${call.functionName}`)
    },
  }
}

function failingLookupClient(): any {
  return {
    readContract: async () => {
      throw new Error('request timed out')
    },
    getBlockNumber: async () => {
      throw new Error('request timed out')
    },
    getLogs: async () => {
      throw new Error('request timed out')
    },
  }
}

function ownedTokenClient(owner: string, tokenId: bigint, cid: string, name: string): any {
  return {
    getBlockNumber: async () => 500_000_000n,
    getLogs: async () => [{ args: { tokenId } }],
    readContract: async (call: { functionName: string }) => {
      if (call.functionName === 'balanceOf') return 1n
      if (call.functionName === 'ownerOf') return owner
      if (call.functionName === 'tokenURI') return agentDataUri(cid, name)
      throw new Error(`unexpected read: ${call.functionName}`)
    },
  }
}
