<img src="https://raw.githubusercontent.com/baairon/ethagent/master/preview/image.png" alt="ethagent" />


A privacy-first AI agent with a portable Ethereum identity.

ethagent binds an AI agent to a wallet-owned ERC-8004 token. Persona and memory stay encrypted under your wallet signature and pinned to IPFS. Public skills publish as machine-readable JSON so other agents can discover what it does. Swap models, switch machines, restore the same agent from one onchain pointer.

## Install

ethagent requires Node.js 20 or newer. Install it from npm with `npm install -g ethagent`, then start it with `ethagent`.

## First Run

First run walks model setup, then identity setup. You can use a local GGUF model through llama.cpp, or connect OpenAI, Anthropic, or Gemini.

Create a new ERC-8004 agent with a browser wallet, load an agent token you already own, or skip identity setup and add it later from the Identity Hub.

Use `Alt+P` to swap models and `Alt+I` to open the Identity Hub. Inside the agent, `/help` shows the live command list for the version you are running.

## Identity & Continuity

The Identity Hub manages the portable identity. Each identity gets a local continuity vault under `~/.ethagent/continuity`.

| File | Visibility | Purpose |
| --- | --- | --- |
| `SOUL.md` | Private | Persona, boundaries, standing instructions, and identity framing. |
| `MEMORY.md` | Private | Durable preferences, project context, decisions, and operating notes. |
| `skills.json` | Public | Machine-readable capabilities under schema `ethagent.public-skills.v1`, easy for other agents and apps to parse. |

`SOUL.md` and `MEMORY.md` are encrypted before they reach IPFS. They are never published as plaintext in token metadata.

**Save Snapshot Now** encrypts the current private continuity, pins the public discovery files, writes registration metadata, and updates the ERC-8004 tokenURI. **Refetch Latest Snapshot** reads the current tokenURI from chain, asks the owner wallet to sign the decrypt challenge, and restores local files from the published state. The current tokenURI is the source of truth.

## Models

ethagent works with OpenAI, Anthropic, Gemini, and local GGUF models served through a llama.cpp-compatible endpoint.

The model picker discovers provider models, manages API keys, recommends GGUF files for your machine, and starts or attaches to a local runner. The featured local model is [Qwen3.5-9B-Uncensored](https://huggingface.co/HauhauCS/Qwen3.5-9B-Uncensored-HauhauCS-Aggressive); other Hugging Face GGUF models work by repo ID or URL.

Cloud API keys live in the OS keyring when available, with an encrypted local file under `~/.ethagent` as fallback.

## Tools & Sessions

File ops, shell, clipboard, and MCP tools, all permissioned. Managed edits support `/rewind`. Sessions support `/resume`, `/compact`, and `/export`.

`Shift+Tab` cycles Plan, Accept-Edits, and Chat modes. `Alt+T` toggles reasoning display.

## Privacy

Public information includes token ownership, tokenURI metadata, public discovery files, and IPFS CIDs.

Private information includes plaintext `SOUL.md`, plaintext `MEMORY.md`, sessions, prompt history, API keys, local permissions, and wallet signatures used for decryption.

Continuity snapshots use an EIP-191 wallet signature as unlock material and encrypt with ML-KEM-1024, HKDF-SHA256, and AES-256-GCM. The unlock signature does not submit a transaction, spend funds, or grant token approval.

If an ERC-8004 token is transferred, the new holder can see public metadata and encrypted backup CIDs. They cannot decrypt private continuity that was sealed for the previous owner wallet.

`ethagent reset` deletes local ethagent data from this machine while preserving installed local model assets. It does not burn or transfer ERC-8004 tokens, remove public IPFS content, or mutate onchain metadata. Run **Save Snapshot Now** before resetting if local changes should become the recoverable state.

## Architecture

| Layer | Role |
| --- | --- |
| Runtime | Terminal chat UI, sessions, context, permissions, and workspace tools. |
| Model | Cloud provider or local GGUF runner. |
| Identity | ERC-8004 token owned by the wallet. |
| Continuity | Private files encrypted before IPFS pinning. |
| Discovery | Public `skills.json`, Agent Card, services, and current metadata. |
| Recovery | Refetch current tokenURI, decrypt the latest snapshot, and restore local files. |

The ERC-8004 token is the durable handle. The machine, model, and local session can change around it.

[npm](https://www.npmjs.com/package/ethagent) · [GitHub](https://github.com/baairon/ethagent) · [ERC-8004](https://eips.ethereum.org/EIPS/eip-8004) · [soul.md](https://soul.md/)

MIT License.
