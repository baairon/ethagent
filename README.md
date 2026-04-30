<img src="https://raw.githubusercontent.com/baairon/ethagent/master/preview/image.png" alt="ethagent" />


A privacy-first AI agent with a portable Ethereum identity. Your agent token lives onchain, your private continuity is encrypted before it is pinned to IPFS, and the model is a replaceable component you can swap at any time.

Requires Node.js 20 or newer.

    npm install -g ethagent
    ethagent

## Why ethagent

Every model vendor wants you locked in. Your chat history on their servers, your custom instructions in their account, everything your agent learned about you confined to their ecosystem. Switch vendors and you start over.

ethagent is built around the opposite assumption: the agent should belong to the wallet that controls it. Your Ethereum address is the durable handle, your accumulated knowledge is encrypted for that identity, and the model in the middle remains interchangeable.

## How it works

On first run, ethagent creates or restores an ERC-8004 agent with the browser wallet you already use. The wallet owns the token, while encrypted agent state is pinned to IPFS so the same agent can be restored on another machine.

- Mint or load an ERC-8004 agent token
- Back up encrypted continuity to IPFS and refresh the tokenURI
- Switch between OpenAI, Anthropic, Gemini, and local GGUF models
- Featured local model: [Qwen3.5-9B-Uncensored](https://huggingface.co/HauhauCS/Qwen3.5-9B-Uncensored-HauhauCS-Aggressive) with automatic download and runner setup. We prioritize uncensored models to eliminate capability loss from artificial refusals, reflecting Ethereum's core values of neutrality and permissionless use.
- Download additional GGUF models by link with safety review, machine-aware recommendation, and local runner startup
- Resume, rewind, compact, export, and diagnose local sessions

## Continuity files

ethagent keeps three identity markdown files in the local identity vault:

- `SOUL.md` private persona, boundaries, and standing instructions
- `MEMORY.md` private durable preferences, project context, and decisions
- `SKILLS.md` public agent discovery metadata and capabilities

When you choose **save snapshot and publish**, ethagent encrypts `SOUL.md` and `MEMORY.md`, pins the encrypted snapshot to IPFS, pins public `SKILLS.md` metadata, and updates the ERC-8004 tokenURI to point at the latest CIDs. The markdown is never written in plaintext onchain.

Your private continuity is encrypted for the wallet that authorized each snapshot. If the ERC-8004 token is transferred, the new holder can see public token metadata and backup CIDs, but cannot decrypt prior private memory without an explicit re-encryption handoff. For more background on portable agent identity and continuity, see [soul.md](https://soul.md/).

## Local data and reset

`ethagent reset` wipes local identity metadata, markdown vaults, sessions, prompt history, rewind history, permissions, and stored credentials from this machine. Installed local LLM assets are kept. Onchain tokens and IPFS-pinned snapshots are not affected.

Before resetting, open `alt+i` and use **snapshots** or **save snapshot and publish** if your local continuity has changes you want to keep.

## Architecture

| Layer | What it does |
|---|---|
| Inference | Hotswappable model, local or cloud |
| Identity | ERC-8004 token owned by your wallet controls the agent identity |
| Backup | Encrypted SOUL.md and MEMORY.md snapshots pinned to IPFS |
| Discovery | Public SKILLS.md metadata pinned to IPFS and referenced from tokenURI |
| Registration | ERC-8004 onchain agent record, restorable from address or ENS |

Identity is the foundation. Once your ERC-8004 token exists, every other layer attaches to it.

## Links

[npm](https://www.npmjs.com/package/ethagent) · [GitHub](https://github.com/baairon/ethagent) · [ERC-8004](https://eips.ethereum.org/EIPS/eip-8004) · [soul.md](https://soul.md/)

## License

MIT
