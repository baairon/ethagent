<img src="https://raw.githubusercontent.com/baairon/ethagent/master/preview/image.png" alt="ethagent" />

A privacy-first AI agent with a portable Ethereum identity. Your identity lives on Ethereum. Your memory lives on IPFS. The model is a replaceable component you can swap any time.

```bash
npm install -g ethagent
ethagent
```

## Why ethagent

Every model vendor wants you locked in: your chat history on their servers, your custom instructions in their account, everything your agent learned about you confined to their ecosystem. Switch vendors and you start over.

`ethagent` flips that. The agent belongs to you, not the platform. Your Ethereum address is the durable handle. Your accumulated knowledge is encrypted for that identity and content-addressed so it travels with the address rather than the vendor. The model in the middle is interchangeable.

## How it works

On first run, `ethagent` helps you create or import an Ethereum identity for your agent. That address becomes the durable handle for everything the agent learns and does. The key is encrypted locally for day-to-day use, then backed up as an encrypted recovery blob that can be pinned to IPFS.

After setup, start a terminal session and chat with OpenAI, Anthropic, Gemini, or a local Ollama model. Use `Alt+P` to pick a provider/model, or `/model <name>` to switch models within the current provider. Resume, rewind, compact, export, and diagnose sessions without losing continuity.

On a new machine, your wallet authorizes recovery, `ethagent` fetches the encrypted backup from IPFS, and the same agent identity comes back. Memory is encrypted for that identity and pinned to IPFS too, so the agent can move with you across devices.

The agent is registered onchain via [ERC-8004](https://eips.ethereum.org/EIPS/eip-8004), making the same address usable for discovery, recovery, and delegation.

## Architecture

| Layer | What it does |
|---|---|
| Inference | Hotswappable model, local or cloud |
| Identity | Ethereum address controls the agent identity |
| Backup | Encrypted identity backup pinned to IPFS, recoverable by wallet authorization |
| Memory | Encrypted, content-addressed, pinned to IPFS |
| Registration | ERC-8004 onchain agent record, restorable from address or ENS |

Identity is the foundation. Once your address exists, every other layer attaches to it.

---

## Links

- [npm](https://www.npmjs.com/package/ethagent)
- [GitHub](https://github.com/baairon/ethagent)
- [ERC-8004](https://eips.ethereum.org/EIPS/eip-8004)

## License

MIT
