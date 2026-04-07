<img src="https://bairon.dev/preview/cli.png" alt="ethagent" width="600" />


A privacy-first AI agent with a permanent Ethereum identity. Your knowledge base lives on IPFS. Your agent's identity is registered onchain, tied to your wallet. Your inference never leaves your machine.

```bash
npm install -g ethagent
```

## What It Is

ethagent bootstraps a local LLM on your machine and builds a personal knowledge base from sources you define. It works completely offline. No wifi, no API, just your hardware. The model is hotswappable, and if you need to, you can point it at a cloud model without losing any context. Offline-capable agents are going to be a core part of how software gets built, and ethagent is built for that from day one.

- Your Ethereum address owns and controls your agent
- Your knowledge base is pinned to IPFS, content-addressed and portable
- Your agent is registered onchain via [ERC-8004](https://eips.ethereum.org/EIPS/eip-8004)
- Everything you teach it compounds across sessions, not just within them

Wipe your laptop, restore from your address or ENS name, and you're back exactly where you left off.

```bash
npx ethagent init --from bairon.eth
npx ethagent init --from 0xA1E977e700bF82019beb381F1582575303A389CE
```

## Why It Exists

AI platforms compete aggressively and users switch between them constantly. Every time you do, your conversation history, custom instructions, and everything your agent learned about you resets to zero. But every prompt you sent to the old platform is still there, training their next model.

ethagent breaks that cycle. Your knowledge lives on IPFS, your identity lives on Ethereum. Switch models whenever you want. Your agent remembers everything regardless. Your data stays yours, not by policy, but by architecture.

## How It Works

ethagent accumulates a personal knowledge base from conversations, documents, and corrections you provide. That knowledge base is pinned to IPFS, so it's content-addressed, verifiable, and not locked to any single device. The underlying model is hotswappable, so you can run a local LLM or swap in a cloud model without losing any context.

Your agent's identity is registered onchain using ERC-8004, the token standard for autonomous agents on Ethereum. Identity is tied to an Ethereum address or ENS name, meaning your agent can be fully restored on any machine from just your address.

Think of it like a tamagotchi that lives in your wallet. You raise it, you feed it knowledge, and only your key can summon it. Every interaction compounds. It doesn't flatten your context into a generic system prompt. It accumulates. And because it lives on IPFS, it follows you to any machine you bring your wallet to.

| Layer | Where | What it does |
|-------|-------|--------------|
| Inference | Your machine (or cloud) | Hotswappable model, local-first by default |
| Knowledge | IPFS | Content-addressed, verifiable, portable across any machine |
| Identity | Ethereum | Permanent agent registration via ERC-8004, restorable from address or ENS |

Your knowledge base is encrypted with your wallet's key. Only you can decrypt it. Even though the data lives on IPFS, it's unreadable to anyone without your key. Nobody can clone your agent, read its memories, or extract what it knows about you.

## Links

- [npm package](https://www.npmjs.com/package/ethagent)
- [GitHub](https://github.com/baairon/ethagent)
- [ERC-8004 specification](https://eips.ethereum.org/EIPS/eip-8004)

## License

MIT
