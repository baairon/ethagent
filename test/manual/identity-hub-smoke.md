# Identity Hub Smoke Test

Use this checklist for live ERC-8004 wallet testing. The security goal is that token ownership enables discovery and token control, but old encrypted memory remains readable only by the wallet that authorized that snapshot.

## Prerequisites

- Wallet A: original minter.
- Wallet B: non-owner wallet for transfer/theft simulation.
- Both wallets funded on the chosen supported network.
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

## Transfer Or Theft Simulation

1. Transfer the ERC-8004 token from Wallet A to Wallet B.
2. Use a clean local profile and restore by entering Wallet B.
3. Select the same network.
4. Expected: ethagent discovers the token because `ownerOf` is Wallet B.
5. Continue restore.
6. Expected: ethagent stops before wallet signing with `snapshot locked to previous wallet`.
7. Expected: Wallet B can see public token metadata and backup CIDs, but cannot decrypt Wallet A's prior encrypted state.

## Original Owner After Transfer

1. Restore by entering Wallet A after the token has moved.
2. Expected: discovery does not present the transferred token under Wallet A.
3. If Wallet A still has an old state CID outside the discovery flow, Wallet A can decrypt that historical snapshot; this does not imply current token ownership.

## Automated Checks

Run these before or after the live smoke:

```bash
cmd /c npm run typecheck
cmd /c npm test -- identityBackupEnvelope
cmd /c npm test -- identityHub
cmd /c npm test -- erc8004Metadata
```
