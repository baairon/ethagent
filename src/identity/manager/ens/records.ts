import { AGENT_TOKEN_RECORD_KEY, buildEnsip25Key } from '../../ens/agentRecords.js'
import { SUPPORTED_ERC8004_CHAINS } from '../../registry/erc8004.js'

// Every text record ethagent may have written for this agent on a name: the ENSIP-25
// key for each supported chain, since the token may have moved between them, and the
// token reference. Clearing an old name clears all of them.
export function agentEnsRecordKeys(identityRegistryAddress: string, agentId: string | bigint | undefined): string[] {
  if (agentId === undefined || agentId === '') return []
  return [
    ...SUPPORTED_ERC8004_CHAINS.map(chain => buildEnsip25Key({
      chainId: chain.chainId,
      identityRegistryAddress,
      agentId,
    })),
    AGENT_TOKEN_RECORD_KEY,
  ]
}
