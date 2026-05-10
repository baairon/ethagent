# ethagent contracts

Solidity contracts that the ethagent CLI deploys to. The only contract here
today is `OperatorVault`: a thin vault that holds ERC-8004 agent tokens and
exposes a least-authority "metadata operator" lane, letting an operator
wallet rotate the agent's `agentURI` without granting it ERC-721 transfer
rights.

## Layout

```
contracts/
  src/
    OperatorVault.sol  # the vault
  test/
    OperatorVault.t.sol  # forge tests
  script/
    Deploy.s.sol  # deployment script
  foundry.toml
```

## Setup

Install [Foundry](https://book.getfoundry.sh/getting-started/installation),
then from inside this directory:

```
forge install foundry-rs/forge-std --no-commit
```

This pulls `forge-std` into `contracts/lib/` (the `lib` path in
`foundry.toml`). The directory is ignored by the repo's top-level git
config; commit only the script and source.

## Test

```
forge test -vv
```

All tests should pass with no deployments. The test suite uses a mock
ERC-8004 registry (`MockErc8004` inside the test file) so no external
state is needed.

## Deploy

The deploy script reads `PRIVATE_KEY`, `REGISTRY`, and `AGENT_ID` from
the environment and broadcasts to whichever RPC the CLI selects.
Example:

```
PRIVATE_KEY=0x... REGISTRY=0x... AGENT_ID=42 \
forge script script/Deploy.s.sol:Deploy \
  --rpc-url base \
  --broadcast \
  --verify \
  -vvvv
```

Deploy one vault per ERC-8004 token that enters Advanced custody. The
TypeScript layer stores the deployed address on that identity as
`operatorVaultAddress`.

## Deployment topology

OperatorVault must live on the same chain as the ERC-8004 registry it
serves. The vault calls `IERC8004URI(registry).setAgentURI(agentId,
newURI)` directly on the registry, and ERC-721 `safeTransferFrom` lands
at the vault on the same chain. There are no cross-chain calls; deploying
on Ethereum mainnet alone does not service L2 users.

The current vault is not a singleton per chain. New Advanced custody
deployments are dedicated to one ERC-8004 token, and the constructor
binds each vault to that registry and token ID.

End users deploy during Advanced custody setup, then sign deposit
(`ERC-8004.safeTransferFrom`) and unwrap (`OperatorVault.unwrap`)
transactions for their own agent token.

## Properties

- No admin. No upgrade path. No pause. No `selfdestruct`. No fallback.
- One deployment holds at most one active ERC-8004 token.
- The vault's owner-level role is "depositor of the underlying token,"
  recorded when `safeTransferFrom` is invoked into the vault. The
  depositor can authorize/revoke metadata operators and unwrap the
  token. Operators can only rotate the agent's URI.
- Operator entries are authorization-epoch scoped. When the underlying
  token leaves and a token is deposited later, stale operator entries no
  longer authorize URI rotation until the current owner approves again.
