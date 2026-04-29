import test from 'node:test'
import assert from 'node:assert/strict'
import { encodeAbiParameters, encodeEventTopics, parseAbiItem } from 'viem'
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
  parseEthagentPublicDiscoveryPointer,
  preflightRegisterAgent,
  registeredAgentFromReceipt,
  withEthagentBackupPointer,
} from '../src/identity/erc8004.js'

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
  )

  assert.equal(updated.name, 'agent')
  assert.equal((updated['x-ethagent'] as { backup: { cid: string } }).backup.cid, 'bafy-backup')
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
      skillsCid: 'bafy-skills',
      agentCardCid: 'bafy-card',
      updatedAt: new Date(0).toISOString(),
    },
  )
  const pointer = parseEthagentPublicDiscoveryPointer(updated)
  const ext = updated['x-ethagent'] as {
    publicSkills: { cid: string; format: string }
    agentCard: { cid: string; format: string }
  }
  const services = updated.services as Array<{ type: string; name?: string; url: string }>

  assert.equal(pointer?.skillsCid, 'bafy-skills')
  assert.equal(pointer?.agentCardCid, 'bafy-card')
  assert.equal(ext.publicSkills.format, 'text/markdown')
  assert.equal(ext.agentCard.format, 'application/json')
  assert.ok(services.some(service => service.type === 'a2a' && service.url === 'ipfs://bafy-card'))
  assert.ok(services.some(service => service.type === 'ipfs' && service.name === 'public-skills' && service.url === 'ipfs://bafy-skills'))
  assert.equal(JSON.stringify(updated).includes('SOUL.md'), false)
  assert.equal(JSON.stringify(updated).includes('MEMORY.md'), false)
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
    assert.equal(err.title, 'not enough ETH')
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
    assert.equal(err.title, 'registration blocked')
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

test('discoverOwnedAgentBackups asks for token id when positive balance logs time out', async () => {
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
        throw new Error(`unexpected read: ${call.functionName}`)
      },
    } as any,
  }), AgentTokenIdRequiredError)
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
  assert.throws(() => erc8004ConfigForSupportedChain(99999), /unsupported ERC-8004 chain id/)
})

function agentDataUri(cid: string, name = 'agent'): string {
  return `data:application/json,${encodeURIComponent(JSON.stringify({
    name,
    'x-ethagent': {
      backup: {
        cid,
        envelopeVersion: 'ethagent-state-backup-v1',
        createdAt: new Date(0).toISOString(),
      },
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
