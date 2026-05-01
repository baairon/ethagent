<img src="https://raw.githubusercontent.com/baairon/ethagent/master/preview/image.png" alt="ethagent" />


A privacy-first AI agent with a portable Ethereum identity.

ethagent is a terminal agent for coding and project work. It gives the agent a wallet-owned ERC-8004 identity, keeps private continuity encrypted, and publishes public capability metadata as structured JSON so other applications and agents can understand what it can do.

The identity stays portable. The model can change. The private memory stays under wallet-gated encryption.

## Install

ethagent requires Node.js 20 or newer. Install it from npm with `npm install -g ethagent`, then start it with `ethagent`.

On first run, ethagent guides you through model setup and identity setup. You can use a local GGUF model through llama.cpp, or connect OpenAI, Anthropic, or Gemini.

## What It Does

* Runs an AI coding agent in your terminal.
* Switches between cloud models and local GGUF models.
* Creates or loads a wallet-owned ERC-8004 agent identity.
* Encrypts private continuity before IPFS pinning.
* Publishes public `skills.json` and Agent Card metadata for discovery.
* Restores the same agent on another machine from the onchain record.
* Supports workspace tools, managed edit rewind, session resume, context compaction, and MCP servers.

## First Run

Start with `ethagent`. The setup flow asks for a model path first, then offers identity setup.

You can create a new ERC-8004 agent with a browser wallet, load an agent token you already own, or skip identity setup and add it later from the Identity Hub.

Use `Alt+P` to switch models and `Alt+I` to open the Identity Hub. Inside the agent, `/help` shows the live command list for the version you are running.

## Identity Hub

The Identity Hub is where the portable identity is managed.

| Area | What It Controls |
| --- | --- |
| Public Metadata | Profile name, description, image, `skills.json`, and Agent Card. |
| Private Local Files | `SOUL.md`, `MEMORY.md`, and the local copy of `skills.json`. |
| Recovery | Publishing the current encrypted snapshot or refetching the latest one from chain. |
| Storage | The Pinata JWT used to pin continuity and metadata to IPFS. |
| Agent Token | Registry, owner, token, URI, CID, and copyable identity values. |

The hub is a recovery panel, not a history archive. The current tokenURI is the source of truth for the latest published state.

## Continuity

Each identity gets a local continuity vault under `~/.ethagent/continuity`.

| File | Visibility | Purpose |
| --- | --- | --- |
| `SOUL.md` | Private | Persona, boundaries, standing instructions, and identity framing. |
| `MEMORY.md` | Private | Durable preferences, project context, decisions, and operating notes. |
| `skills.json` | Public | Machine-readable capabilities, input modes, output modes, and discovery metadata. |

`SOUL.md` and `MEMORY.md` are encrypted before they are pinned to IPFS. They are not published as plaintext in token metadata.

`skills.json` is public by design. It uses schema `ethagent.public-skills.v1` and is meant to be easy for other agents, apps, and scanners to parse.

## Recovery

**Publish Snapshot Now** encrypts the current private continuity, pins the public discovery files, writes current registration metadata, and updates the ERC-8004 tokenURI.

**Refetch Latest Snapshot** reads the current tokenURI from chain, downloads the encrypted continuity envelope, asks the owner wallet to sign the decrypt challenge, and restores local continuity files from the published state.

Publishing replaces the current onchain pointer. Registration metadata contains the current CIDs only.

## Public Discovery

The public registration metadata is intentionally compact. It describes the current state of the agent, not its history.

It can include:

* Agent name, description, and image.
* Current encrypted continuity CID.
* Current public `skills.json` CID.
* Current Agent Card CID.
* Service entries with canonical `endpoint` values.
* Registry linkage through `registrations[]`.

This is enough for baseline agent-to-agent discovery and delegation without exposing private memory or installing executable code.

## Models

ethagent works with OpenAI, Anthropic, Gemini, and local GGUF models served through a llama.cpp-compatible endpoint.

The model picker can discover provider models, manage cloud API keys, recommend GGUF files for the machine, and start or reconnect to a local runner when supported.

The featured local model is [Qwen3.5-9B-Uncensored](https://huggingface.co/HauhauCS/Qwen3.5-9B-Uncensored-HauhauCS-Aggressive). You can also add other Hugging Face GGUF models by repo ID or URL.

Cloud API keys are stored in the OS keyring when available. If a keyring is unavailable, ethagent uses an encrypted local file under `~/.ethagent`.

## Tools And Workspace

ethagent is built for real project work. It can read files, edit files, write new files, delete files, inspect directories, run shell commands, copy text to the clipboard, and connect MCP tools.

Tool use is permissioned. Managed edits are tracked so recent workspace changes can be rewound from inside the agent.

Sessions are local. You can resume prior sessions, export a transcript, compact older context, and review saved project permissions.

## Privacy

Public information includes token ownership, tokenURI metadata, public discovery files, and IPFS CIDs.

Private information includes plaintext `SOUL.md`, plaintext `MEMORY.md`, sessions, prompt history, API keys, local permissions, and wallet signatures used for decrypting continuity.

Continuity snapshots use an EIP-191 wallet signature as unlock material and encrypt with ML-KEM-1024, HKDF-SHA256, and AES-256-GCM. The unlock signature does not submit a transaction, spend funds, or grant token approval.

If an ERC-8004 token is transferred, the new holder can see public metadata and encrypted backup CIDs. They cannot decrypt private continuity that was encrypted for the previous owner wallet.

## Local Reset

`ethagent reset` deletes local ethagent data from this machine while preserving installed local model assets. It does not burn or transfer ERC-8004 tokens, remove public IPFS content, or mutate onchain metadata.

Before resetting, use **Publish Snapshot Now** if local continuity changes should become the current recoverable state.

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

## Links

[npm](https://www.npmjs.com/package/ethagent) · [GitHub](https://github.com/baairon/ethagent) · [ERC-8004](https://eips.ethereum.org/EIPS/eip-8004) · [soul.md](https://soul.md/)

## License

MIT
