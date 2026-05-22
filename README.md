<img src="https://raw.githubusercontent.com/baairon/ethagent/master/preview/image.svg" alt="ethagent" width="640" />

A privacy-first AI agent with a portable Ethereum identity.

Switch providers or machines and the AI agent you customized stays behind. `ethagent` ties the agent to a wallet you own, so its soul, memory, and skills follow you across providers, machines, and models.

- **Portable.** Restore the same agent on any machine from a wallet you own.
- **Private.** Soul, memory, and skills are encrypted on your machine before they sync. The wallet signature that unlocks them stays local and never spends funds.
- **Public.** Other agents discover the agent's capabilities through a public Agent Card.

## Install

ethagent runs on [Node.js](https://nodejs.org).

```bash
npm install -g ethagent
ethagent
```

## First Run

First run inspects the machine for local-model fit, sets up the agent's onchain identity, and picks a model. Identity can be a fresh ERC-8004 token created with a browser wallet, an existing token in your wallet, or skipped and set up later from the Identity Hub.

Once running:

- `Alt+P` reopens the model picker
- `Alt+I` reopens the Identity Hub
- `/help` lists every command live for the version installed

## Identity Hub

The Identity Hub manages everything portable about the agent:

- **Public Profile** edits name, description, and icon: what other agents see in the Agent Card.
- **ENS Name** links the agent to a subdomain under a parent name the owner wallet controls.
- **Custody Mode** switches between Simple and Advanced by depositing the token into its operator delegation vault or unwrapping it back out.
- **Prepare Transfer** stages a dual-wallet snapshot so the receiver can restore the agent after the token moves externally.
- **Refetch Latest** pulls the most recent published snapshot back to local files.
- **Switch Agent** accepts an ENS name or an ERC-8004 token ID on any supported chain, and loads any agent owned by or linked to the connected wallet.

## Continuity

Each agent has a continuity directory at `~/.ethagent/continuity` holding a small set of private files. They are encrypted before they ever reach IPFS.

| File | Visibility | Purpose |
| --- | --- | --- |
| `SOUL.md` | Private | Soul, boundaries, standing instructions, and identity framing. |
| `MEMORY.md` | Private | Durable preferences, project context, decisions, and operating notes. |
| `skills/` | Private | Skill folders. The SKILL.md body never leaves your machine. The visibility flag only controls whether the skill's name and description get listed in the Agent Card. New skills default to public. |

Skill frontmatter (name, description, when_to_use, visibility, tags) tells the agent when to load each skill.

- **Save Snapshot Now** encrypts the private files, pins them to IPFS, and rotates the onchain pointer to the new CID.
- **Refetch Latest** reads the pointer back, signs the decrypt challenge with your wallet, and overwrites local files from the snapshot.
- Agents can be looked up by token ID or ENS name on [8004scan](https://8004scan.io/).

## Custody Modes

Custody comes in two modes. Switch between them anytime from **Custody Mode**.

**Simple** relies on one wallet to own the token, sign every snapshot save, and rotate the onchain URI directly. Use Simple when one wallet operates the agent.

**Advanced** splits an owner wallet from one or more operator wallets. The owner wallet owns this agent's operator delegation vault; one or more operator wallets handle routine URI rotations through that vault. Use Advanced when routine saves should not require an owner signature.

Granting an operator wallet ERC-721 approval would let it rotate the URI, but that same approval also lets it transfer the token away. The vault holds the token instead and exposes only a URI-rotation lane for that agent. Operators never receive token approval or transfer rights, cannot touch ENS, and cannot grant rights to other operators. The owner still signs to authorize or revoke operators for the agent, withdraw the token, or transfer the agent.

## ENS Names

Subdomains live under a parent name you control, never on root `.eth` names directly. You keep `you.eth`; the agent gets `agent.you.eth`. The split makes the boundary explicit: one address speaks for the human, the other speaks for the agent.

ENS records stay owner-controlled in both custody modes. Operator wallets in Advanced custody rotate the ERC-8004 token URI through the vault (see Custody Modes), not ENS. Any ENS text-record update requires an owner signature.

Save the token ID and network somewhere safe. ENS records can be cleared and rebuilt; the token ID is the durable handle.

## Token Transfers

**Prepare Token Transfer** runs before any ERC-8004 token transfer, and only when the token sits directly in your wallet. An agent in Advanced custody has to switch to Simple first from Custody Mode, which unwraps the token from its vault back to the owner wallet.

- Sender signs snapshot access, receiver signs restore access.
- Sender publishes the snapshot pointer to the agent URI.
- The actual transfer happens externally afterwards, in whichever wallet UI you prefer.
- Once the token has moved, the receiver opens **Switch Agent** with the receiving wallet and restores the same agent from the published snapshot.

## Models

ethagent works with OpenAI, Anthropic, Gemini, and local GGUF models served through a llama.cpp-compatible endpoint.

- The model picker discovers provider models, manages API keys, recommends GGUF files for the host machine's memory and CPU, and starts or attaches to a local llama.cpp runner.
- The featured local model is [Qwen3.5-9B-Uncensored](https://huggingface.co/HauhauCS/Qwen3.5-9B-Uncensored-HauhauCS-Aggressive); other Hugging Face GGUF models work by repo ID or direct URL.
- Cloud API keys live in the OS keyring when one is available, with an encrypted local file under `~/.ethagent` as fallback.

### Image Input

Press `Alt+V` to paste an image from the clipboard. Vision works on current OpenAI, Anthropic, and Gemini models, and on local GGUF models loaded with an `mmproj-*.gguf` projector.

## Tools and Sessions

- File ops, shell, clipboard, and MCP tools all run through the same permission layer.
- Managed edits support `/rewind` to step back through changes.
- Sessions support `/resume` to continue a previous conversation, `/compact` to summarize the running context, and `/export` to write a transcript to disk.
- `Shift+Tab` cycles between Plan, Accept-Edits, and Chat modes.
- `Alt+T` toggles the reasoning display.

## Privacy

- **Public:** token ownership, the agent URI, the Agent Card it references, and IPFS CIDs.
- **Private:** plaintext `SOUL.md`, plaintext `MEMORY.md`, the local skills/ tree, sessions, prompt history, API keys, local permissions, and the wallet signatures used for decryption.
- Snapshots use a wallet signature as unlock material. The signature does not submit a transaction, spend funds, or grant token approval.
- `ethagent reset` clears local ethagent data from the current machine while preserving installed local model assets; it does not touch onchain state or pinned IPFS content. Run **Save Snapshot Now** first if local edits should become the recoverable state.

## Architecture

| Layer | Role |
| --- | --- |
| Runtime | Terminal chat UI, sessions, context, permissions, and workspace tools. |
| Model | Cloud provider or local GGUF runner. |
| Identity | ERC-8004 token owned by the wallet. |
| Continuity | Private files encrypted before IPFS pinning. |
| Discovery | The agent URI and the Agent Card it points to. |
| Recovery | Refetch the current agent URI, decrypt the latest snapshot, and restore local files. |

## Development

```bash
git clone https://github.com/baairon/ethagent.git
cd ethagent && npm install
npm start
```

`npm run build` is a type-check pass; the published CLI runs the shipped TypeScript directly through `tsx`.

| Command | What it does |
| --- | --- |
| `npm start` | Run from source. |
| `npm run build` | Validate the shipped TypeScript source package. |
| `npm test` | Test suite. |
| `npm run typecheck` | Run the same TypeScript check directly. |
| `npm run contracts:test` | Foundry tests (only needed for `contracts/` changes). |

## Contributing

Contributions are welcome. For anything beyond a typo, open an issue first at [github.com/baairon/ethagent/issues](https://github.com/baairon/ethagent/issues) so the scope and approach can be agreed before code is written. Each PR should cover one logical change, include a clear description, and list the commands you ran for testing. Contributions are released under the MIT license.

[npm](https://www.npmjs.com/package/ethagent) | [GitHub](https://github.com/baairon/ethagent) | [ERC-8004](https://eips.ethereum.org/EIPS/eip-8004) | [soul.md](https://soul.md/)
