<p align="center">
  <img src="preview/image.svg" alt="ethagent" width="100%">
</p>

You don't really own your AI agent. It lives on a platform you don't control, and it stays there the day you leave.

`ethagent` gives it a portable identity instead: a token you hold in your wallet, not an account on someone else's server. Hold the token and you hold the agent.

Its soul, memory, and skills travel with it, encrypted and restored on any machine exactly as you left it. You hold the only key, so no host can read it and no platform can take it away.

Own your agent. Carry it anywhere.

## 🚀 Quick start

**1. Create your agent.** In a terminal, run:

```bash
npx ethagent
```

You'll need an Ethereum wallet, the same wallet that holds and unlocks your agent. Using it day to day is free; creating your agent and saving backups are the only steps that happen onchain.

A guided menu does the rest: create its token, give it a name, and write who it is. Your wallet signs each step.

**2. Use it anywhere.** That's the whole setup. ethagent wires itself into the AI tools you use, like Claude Code and Codex, automatically and with no extra steps, on any machine or operating system. Your agent follows you everywhere and keeps learning as you go; you'll only open `ethagent` again to hand-edit it or save a backup.

Using Claude Code? Add the plugin for the richest experience. Paste these in one at a time:

```
/plugin marketplace add baairon/ethagent
```

then:

```
/plugin install ethagent@ethagent
```

After it installs, reload the plugin and restart Claude Code so the hooks take effect.

## 📦 Soul, memory, skills

- **Soul** (`SOUL.md`): who it is, your standards, your voice, the way you work.
- **Memory** (`MEMORY.md`): what it has learned about you, your preferences, and your projects, so context survives the move to a new machine.
- **Skills:** the commands and know-how you teach it, encrypted in your vault. Private by default; make one public to share it.

You grow these mostly by talking: your agent updates its own soul and memory as you work, and you can just ask it to create a skill. Changes sync everywhere automatically; open `ethagent` to edit by hand, or choose **Save Snapshot** to back it up onchain.

## 💡 How it works

1. **Own it.** Your wallet holds an ERC-8004 token; that token, not a platform account, is the agent.
2. **Configure it.** Shape its soul, memory, and skills. Optionally, give it an ENS name you own.
3. **Save it.** `ethagent` encrypts everything on your machine, stores the encrypted copy on IPFS, and updates your token to point at it.
4. **Restore it.** On any machine, `ethagent` finds your agent automatically from your connected wallet, or by ENS name or token id, then reads the pointer, asks your wallet to sign, and fetches and decrypts the snapshot to rebuild it.

## ✨ Using your agent

Your agent follows you. ethagent wires itself into the tools you use, like Claude Code and Codex, and keeps them in step in the background, so it's the same everywhere. Update it in one tool and the change carries to the rest. You never run a sync command, and `ethagent pause` stops it anytime.

One honest difference: in Claude Code your agent is also kept on track in the moment, if it tries to save something where it won't travel, it's redirected. Other tools get the same rules in writing and the same syncing, just without that live nudge, so the experience is a bit more polished on Claude Code.

## 🔒 What stays private

Everything is encrypted on your machine before it leaves: soul, memory, and skills. The keys come from a wallet signature `ethagent` never sees, so the network only ever holds a locked box that only your wallet can open. The one exception is what you choose to publish: a public skill's name and description appear on your token's card.

## 🔑 Custody

You choose how tightly the agent is held, and you can change it later.

- **Simple.** One wallet owns the agent and signs every save. The default for solo use.
- **Advanced.** Most people never need this. Your main wallet owns the agent and keeps it in a Vault, while extra "operator" wallets you approve can save backups and publish updates without the main wallet signing each time. The Vault still lets only the owner move or sell the agent, so operators can **never** take it.

To move the agent to another wallet, stage a transfer snapshot in `ethagent`. Both wallets sign locally to re-encrypt the soul, memory, and skills for the new owner, so both have to be available on the same machine. Then transfer the token, and the new owner restores the agent exactly as you left it.

## 🔍 Architecture

Built on open standards, so your agent is never tied to one app.

| Layer | Built on | What it does |
| --- | --- | --- |
| Ownership | ERC-8004 | The onchain token your wallet holds, on Ethereum mainnet or Base. Owning it is what makes the agent yours. |
| Discovery | Agent Card | Your public profile and skill listing, carried by the token, so other agents can find yours. |
| Naming | ENS | An optional readable name that resolves to your agent and restores it from the name alone. |
| Backup | IPFS snapshot | The encrypted bundle of soul, memory, and skills, pinned offchain and unlocked only by your wallet. |

## 🔄 Updating

ethagent updates itself. Everything runs through `npx ethagent`, which always fetches the latest published version, so a new release reaches you with nothing to install. If you keep a global copy on your PATH, refresh it with:

```bash
npm i -g ethagent@latest
```

Check what you're running with `ethagent --version`. Update the Claude Code plugin from the marketplace with `/plugin`.

## ⌨️ Commands

Run with `npx ethagent`:

| Command | What it does |
| --- | --- |
| `ethagent` | Open the interactive manager (create, ENS, custody, transfer). |
| `save` | Back up your agent onchain (you sign in your wallet). |
| `--add <path>` | Wire a tool ethagent doesn't auto-detect (point at its `AGENTS.md`). |
| `pause` / `resume` | Pause or resume background sync. |
| `--status` | Show the agent summary and detected tools. |
| `--demo` | Open the interactive manager preloaded with a sample agent, so you can explore how ethagent works without creating an identity, connecting a wallet, or going online. |
| `reset` | Delete the local identity, data, and secrets. |
