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

- Create or import an identity on first run. Your agent gets an Ethereum address that becomes its durable handle.
- Keep the key encrypted locally for daily use. A recoverable backup can be encrypted and pinned to IPFS.
- Chat with OpenAI, Anthropic, Gemini, or a local Ollama model. Use `Alt+P` to pick a provider/model, or `/model <name>` to switch models within the current provider.
- Keep continuity across sessions with resume, rewind, compaction, export, and diagnostics.
- Restore on a new machine by authorizing with your wallet, fetching the encrypted IPFS backup, and bringing back the same agent identity.
- Register the agent onchain via [ERC-8004](https://eips.ethereum.org/EIPS/eip-8004) so the same address can be used for discovery, recovery, and delegation.

Memory is encrypted for that identity and pinned to IPFS too, so the agent can move with you across devices.

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
