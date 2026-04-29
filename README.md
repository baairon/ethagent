<img src="https://raw.githubusercontent.com/baairon/ethagent/master/preview/image.png" alt="ethagent" />

A privacy-first AI agent with a portable Ethereum identity. Your identity lives on Ethereum. Your encrypted memory is pinned to IPFS. The model is a replaceable component you can swap any time.

```bash
npm install -g ethagent
ethagent
```

## Why ethagent

Every model vendor wants you locked in: your chat history on their servers, your custom instructions in their account, everything your agent learned about you confined to their ecosystem. Switch vendors and you start over.

ethagent is built around the opposite assumption: the agent should belong to the wallet that controls it. Your Ethereum address is the durable handle, your accumulated knowledge is encrypted for that identity, and the model in the middle remains interchangeable.

## How it works

On first run, ethagent creates or restores an ERC-8004 agent with the browser wallet you already use. The wallet owns the token, while encrypted agent state is pinned to IPFS so the same agent can be restored on another machine.

- Mint or load an ERC-8004 agent token.
- Back up encrypted state to IPFS and refresh the tokenURI.
- Switch between OpenAI, Anthropic, Gemini, local Ollama models, and link-downloaded Hugging Face GGUF models.
- Download Hugging Face models by link with safety review, machine-aware GGUF recommendation, and local runner startup.
- Resume, rewind, compact, export, and diagnose local sessions.

Your memory is encrypted for the wallet that authorized each backup. If the ERC-8004 token is transferred, the new holder can see public token metadata and backup CIDs, but cannot decrypt prior private memory without an explicit re-encryption handoff.

## Architecture

| Layer | What it does |
|---|---|
| Inference | Hotswappable model, local or cloud |
| Identity | ERC-8004 token owned by your wallet controls the agent identity |
| Backup | Encrypted agent state pinned to IPFS, recoverable by wallet authorization |
| Memory | Encrypted, content-addressed, pinned to IPFS |
| Registration | ERC-8004 onchain agent record, restorable from address or ENS |

Identity is the foundation. Once your ERC-8004 token exists, every other layer attaches to it.

---

## Links

- [npm](https://www.npmjs.com/package/ethagent)
- [GitHub](https://github.com/baairon/ethagent)
- [ERC-8004](https://eips.ethereum.org/EIPS/eip-8004)

## License

MIT
