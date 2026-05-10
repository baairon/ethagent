<img src="https://raw.githubusercontent.com/baairon/ethagent/refs/heads/master/preview/image.png" alt="ethagent" />

A privacy-first AI agent with a portable Ethereum identity.

ethagent binds an AI agent to a wallet-owned ERC-8004 token. Soul and memory stay encrypted under your wallet signature and pinned to IPFS. Public skills publish as plain JSON so other agents can discover what the agent does. Swap models, switch machines, or restore the same agent from a single onchain pointer.

- **Portable.** The ERC-8004 token is the agent's durable identity. Use the ENS name as a readable handle, or the token ID plus chain as the permanent reference, to restore the same agent anywhere.
- **Private.** Soul and memory are encrypted before they are pinned to IPFS. The wallet signature used to unlock them stays local and never submits a transaction, spends funds, or grants token approval.
- **Public.** The agent URI points to plain JSON for the Agent Card and public skills, so other agents can discover capabilities through ERC-8004 and IPFS.

<details>
<summary><strong>Glossary</strong> (click to expand)</summary>

| Term | Meaning |
| --- | --- |
| Owner Wallet | Holds and controls the ERC-8004 agent token. Signs custody changes and, in Simple custody, every URI rotation. |
| Operator Wallet | Additional wallet authorized to rotate the onchain URI on behalf of the owner. Used in Advanced custody. Never receives token approval. |
| Operator Delegation Vault | Immutable contract deployed per agent token in Advanced custody. Each new vault holds at most one ERC-8004 token. |
| Snapshot | Encrypted bundle of SOUL.md, MEMORY.md, and session state. Pinned to IPFS; decrypts only against the owner wallet's signature. |
| Agent URI | IPFS URI stored in the ERC-8004 `tokenURI`. Resolves to the agent's published metadata. |
| Agent Card | Public JSON describing the agent: name, description, capabilities, and skills. Other agents fetch it for discovery. |

</details>

## Install

ethagent runs on Node.js 20 or newer.

```bash
npm install -g ethagent
ethagent
```

## First Run

First run inspects the machine for local-model fit, sets up the ERC-8004 identity, and picks a model.

- **Models** include OpenAI, Anthropic, Gemini, or a local GGUF served through a llama.cpp-compatible endpoint.
- **Identity** can be a fresh ERC-8004 token created with a browser wallet, an existing token already owned by your wallet, or set up later from the Identity Hub.

Once running:

- `Alt+P` reopens the model picker
- `Alt+I` reopens the Identity Hub
- `/help` lists every command live for the version installed

## Identity Hub

The Identity Hub manages everything portable about the agent:

- **Public Profile** edits name, description, icon, and the Agent Card.
- **ENS Name** links the agent to a subdomain and authorizes operator wallets to write the subdomain's records.
- **Custody Mode** switches between Simple and Advanced by depositing the token into its agent vault or unwrapping it back out.
- **Prepare Transfer** stages a dual-wallet snapshot before sending the token externally.
- **Refetch Latest** pulls the most recent published snapshot back to local files.
- **Load Agent** accepts either an ENS name or a bare token ID, and loads any agent owned by or linked to the connected wallet.

The menu surfaces drift automatically. Token ownership, vault state, ENS record alignment, and pending URI rotations are checked against the live chain when the menu opens.

Every agent has a continuity directory at `~/.ethagent/continuity`.

## Continuity

Each agent's continuity directory holds three files. Two are private and encrypted before they ever reach IPFS; one is public so other agents can discover what the agent does.

| File | Visibility | Purpose |
| --- | --- | --- |
| `SOUL.md` | Private | Soul, boundaries, standing instructions, and identity framing. |
| `MEMORY.md` | Private | Durable preferences, project context, decisions, and operating notes. |
| `skills.json` | Public | Machine-readable capabilities. |

- **Save Snapshot Now** encrypts the private files, pins them to IPFS, and rotates the onchain pointer to the new CID.
- **Refetch Latest** reads the pointer back, signs the decrypt challenge with your wallet, and overwrites local files from the snapshot.
- Agents can be looked up by token ID or ENS name on [8004scan](https://8004scan.io/).

## Custody Modes

Custody comes in two modes. Switch between them anytime from **Custody Mode**.

**Simple** relies on one wallet to own the token, sign every snapshot save, and rotate the onchain URI directly. Use Simple when one wallet operates the agent.

**Advanced** splits an owner wallet from one or more operator wallets. The **owner wallet** owns this agent's dedicated OperatorVault; one or more **operator wallets** handle routine URI rotations through that vault. Use Advanced when routine saves should not require an owner signature.

Granting an operator wallet ERC-721 approval would let it rotate the URI, but that same approval also lets it transfer the token away. The agent vault holds the token instead and exposes only a URI-rotation lane for that agent. Operators never receive token approval or transfer rights, cannot touch ENS, and cannot grant rights to other operators. The owner still signs to authorize or revoke operators for the agent, withdraw the token, or transfer the agent.

The vault is an immutable Foundry contract at `contracts/src/OperatorVault.sol`. New vault deployments are dedicated per agent token and reject any other token.

## ENS Names

Subdomains live under a parent name you control, never on root `.eth` names directly. You keep `you.eth`; the agent gets `agent.you.eth`. The split makes the boundary explicit: one address speaks for the human, the other speaks for the agent.

For agents in Advanced custody, the owner wallet approves operator wallets on the resolver once. After that, an approved operator wallet can update the agent's ENS profile pointer (the IPFS CID for the latest agent card) on every snapshot save without another owner signature.

Save the token ID + network somewhere safe. ENS records can be cleared and rebuilt; the token ID is the durable handle.

## Token Transfers

**Prepare Token Transfer** runs before any ERC-8004 token transfer, and only when the token sits directly in your wallet. An agent in Advanced custody has to switch to Simple first from Custody Mode, which unwraps the token from its agent vault back to the owner wallet.

- sender signs snapshot access, receiver signs restore access.
- Sender publishes the snapshot pointer to the agent URI.
- The actual transfer happens externally afterwards, in whichever wallet UI you prefer.
- Once the token has moved, the receiver opens **Load Agent** with the receiving wallet and restores the same agent from the published snapshot.

The token transfer flow prepares decrypt access and agent URI pointers only. It does not initiate the transfer and does not request approval over the token.

## Models

ethagent works with OpenAI, Anthropic, Gemini, and local GGUF models served through a llama.cpp-compatible endpoint.

- The model picker discovers provider models, manages API keys, recommends GGUF files for the host machine's memory and CPU, and starts or attaches to a local llama.cpp runner.
- The featured local model is [Qwen3.5-9B-Uncensored](https://huggingface.co/HauhauCS/Qwen3.5-9B-Uncensored-HauhauCS-Aggressive); other Hugging Face GGUF models work by repo ID or direct URL.
- Cloud API keys live in the OS keyring when one is available, with an encrypted local file under `~/.ethagent` as fallback.

## Tools and Sessions

- File ops, shell, clipboard, and MCP tools all run through the same permission layer.
- Managed edits support `/rewind` to step back through changes.
- Sessions support `/resume` to continue a previous conversation, `/compact` to summarize the running context, and `/export` to write a transcript to disk.
- `Shift+Tab` cycles between Plan, Accept-Edits, and Chat modes.
- `Alt+T` toggles the reasoning display.

## Privacy

- **Public:** token ownership, the agent URI payload, public discovery files, and IPFS CIDs.
- **Private:** plaintext `SOUL.md`, plaintext `MEMORY.md`, sessions, prompt history, API keys, local permissions, and the wallet signatures used for decryption.
- Snapshots use a wallet signature as unlock material. The signature does not submit a transaction, spend funds, or grant token approval.
- The transfer flow writes a snapshot pointer and stops; it never approves or moves the token.
- `ethagent reset` deletes local ethagent data from the current machine while preserving installed local model assets. It does not burn or transfer tokens, remove public IPFS content, or mutate the onchain agent URI. Run **Save Snapshot Now** before resetting if local edits should become the recoverable state.

## Architecture

| Layer | Role |
| --- | --- |
| Runtime | Terminal chat UI, sessions, context, permissions, and workspace tools. |
| Model | Cloud provider or local GGUF runner. |
| Identity | ERC-8004 token owned by the wallet. |
| Continuity | Private files encrypted before IPFS pinning. |
| Discovery | Public `skills.json`, Agent Card, services, and the current agent URI payload. |
| Recovery | Refetch the current agent URI, decrypt the latest snapshot, and restore local files. |

The ERC-8004 token is the durable handle. The machine, model, and local session all change around it.

## Development

```bash
git clone https://github.com/baairon/ethagent.git
cd ethagent && npm install
npm start
```

| Command | What it does |
| --- | --- |
| `npm start` | Run from source. |
| `npm test` | Test suite. |
| `npm run typecheck` | Types. |
| `npm run contracts:test` | Foundry tests. |

Foundry is only needed for `contracts/` changes.

## Contributing

Contributions are welcome. For anything beyond a typo, open an issue first at [github.com/baairon/ethagent/issues](https://github.com/baairon/ethagent/issues) so the scope and approach can be agreed before code is written.

Each PR should cover one logical change, include a clear description, and list the commands you ran for testing. Match project conventions. Do not bundle unrelated cleanup, broad refactors, formatting churn, or changes that have not been reviewed as part of the issue.

Contributions are released under the MIT license.

[npm](https://www.npmjs.com/package/ethagent) | [GitHub](https://github.com/baairon/ethagent) | [ERC-8004](https://eips.ethereum.org/EIPS/eip-8004) | [soul.md](https://soul.md/)
