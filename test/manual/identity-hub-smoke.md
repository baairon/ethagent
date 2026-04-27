# Identity Hub Smoke Test

Use this checklist for live ERC-8004 wallet testing. The covered flow is create, load, back up, edit profile, and remove the active agent from this device. Token transfers require an explicit re-encryption handoff before prior private memory is readable by a new owner.

## Prerequisites

- Wallet A: owner and original minter.
- Wallet funded on the chosen supported network.
- Fresh ethagent config or a backed-up local config.
- IPFS upload credentials available to the app.

## Create And Restore

1. Start ethagent with no active ERC-8004 identity.
2. Create a new ERC-8004 agent with Wallet A.
3. Select network, sign the recovery challenge, and confirm registration.
4. Verify local identity details show owner, token id, tokenURI, state CID, and network.
5. Run back up, sign with Wallet A, and confirm the tokenURI update.
6. Move aside local identity config or use a clean profile.
7. Restore by entering Wallet A address or ENS, selecting the same network, choosing the token if prompted, and signing with Wallet A.
8. Expected: the same agent state restores.

## Switch Existing Agent

1. With an identity already loaded, choose switch/load agent.
2. Expected: the owner/ENS prompt appears before network search and is pre-filled with the current owner.
3. Confirm or edit the owner, then select the network.
4. Expected: search begins only after owner confirmation and network selection.

## Automated Checks

Run these before or after the live smoke:

```bash
cmd /c npm run typecheck
cmd /c npm test -- identityBackupEnvelope
cmd /c npm test -- identityHub
cmd /c npm test -- erc8004Metadata
```
