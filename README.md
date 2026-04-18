<img src="https://raw.githubusercontent.com/baairon/ethagent/master/preview/image.png" alt="ethagent" />

A privacy-first AI agent with a portable Ethereum identity. Your knowledge base lives on IPFS. Your agent's identity is registered onchain, tied to your wallet. Your inference never leaves your machine.

```bash
npm install -g ethagent
ethagent
```

## What It Is

`ethagent` is a local-first terminal agent built around one idea: your agent should belong to you, not to the platform you happened to use first.

The model is replaceable. The memory is portable. The identity is durable.

- Your Ethereum address owns and controls your agent
- Your knowledge base is pinned to IPFS, content-addressed and portable
- Your agent is registered onchain via [ERC-8004](https://eips.ethereum.org/EIPS/eip-8004)
- Everything you teach it compounds across sessions instead of resetting with each vendor switch

## What It Does Today

`ethagent` gives you a portable agent workflow:

- first-run setup with provider selection and key-backed config
- local and cloud model setup and switching
- streaming terminal chat with persistent sessions
- session resume, compaction, copy, export, and diagnostics
- Ethereum-linked agent identity
- IPFS-backed portable memory
- recovery across machines

## Why It Exists

AI platforms compete aggressively and users switch between them constantly. Every time you do, your conversation history, custom instructions, preferences, and everything your agent learned about you resets to zero.

`ethagent` breaks that cycle. Your knowledge lives on IPFS, your identity lives on Ethereum. Switch models whenever you want. Your agent remembers everything regardless. Your data stays yours, not by policy, but by architecture.

## How It Works

`ethagent` accumulates a personal knowledge base from conversations, documents, and corrections you provide. That knowledge base is pinned to IPFS so it is content-addressed, verifiable, and portable across machines. The underlying model is hotswappable, so you can run a local LLM or move to a cloud model without losing continuity.

Your agent's identity is registered onchain using ERC-8004, the token standard for autonomous agents on Ethereum. Identity is tied to an Ethereum address or ENS name, which makes the agent recoverable, portable, and persistent beyond any single machine.

| Layer | Where | What it does |
|---|---|---|
| Inference | Your machine or cloud | Hotswappable model, local-first by default |
| Knowledge | IPFS | Content-addressed, verifiable, portable across any machine |
| Identity | Ethereum | Permanent agent registration via ERC-8004, restorable from address or ENS |

Your knowledge base is encrypted with your wallet's key. Even though the data lives on IPFS, it is unreadable without your key. Nobody can clone your agent, read its memories, or extract what it knows about you.

## Links

- [npm package](https://www.npmjs.com/package/ethagent)
- [GitHub](https://github.com/baairon/ethagent)
- [ERC-8004 specification](https://eips.ethereum.org/EIPS/eip-8004)

## License

MIT
