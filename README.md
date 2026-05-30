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

**2. Add it to Claude Code.** Paste these in once:

```
/plugin marketplace add baairon/ethagent
/plugin install ethagent@ethagent
```

**3. Talk to your agent.** From here on it shows up in every session and gets to know you as you go.

That's the whole setup. Come back to `ethagent` only to edit your agent by hand or back it up.

## 📝 Three files you shape

- **Soul** (`SOUL.md`): who it is, your standards, your voice, the way you work.
- **Memory** (`MEMORY.md`): what it has learned about you, your preferences, and your projects, so context survives the move to a new machine.
- **Skills:** the commands, tools, and prompts you teach it. Public by default, so other agents can discover them; mark one private to keep it off your public Agent Card (the profile your token publishes).

You grow these mostly by talking: with the plugin on, your agent updates its own soul and memory as you converse, and the changes sync automatically. To edit them by hand, open `ethagent`. To save your agent onchain so it can come back on any machine, choose Save Snapshot and sign.

## 💡 How it works

1. **Own it.** Your wallet holds an ERC-8004 token; that token, not a platform account, is the agent.
2. **Configure it.** Shape its soul, memory, and skills under an ENS name you own.
3. **Save it.** `ethagent` encrypts everything on your machine, stores the encrypted copy on IPFS, and updates your token to point at it.
4. **Restore it.** On any machine, `ethagent` reads the pointer, asks your wallet to sign, then fetches and decrypts the snapshot to rebuild your agent, found automatically from your connected wallet, or by ENS name or token id.

## ✨ Using your agent

**Claude Code comes first.** Install the plugin and your agent shows up in every session, already up to date, and anything it learns gets saved back. Nothing to set up.

Using another harness? One command syncs it with `ethagent`:

```bash
npx ethagent --sync
```

It only syncs files between `ethagent` and your harness on this machine. To back it up so you can restore it anywhere, open `ethagent` and choose **Save Snapshot**.

## 🔒 What stays private

Everything is encrypted on your machine before it leaves: `SOUL.md`, `MEMORY.md`, and every skill.

- The encryption keys come from a wallet signature `ethagent` never sees. Signing it is free and moves none of your money. (Saving a backup is separate: it updates your token, a normal transaction with a small fee, usually less than a cent on Base.)
- A public skill is **not** decrypted. The Agent Card on your token publishes your agent's profile (name, description, optional image), each public skill's name and description, and your owner wallet (already public as the token holder).
- Private skills, soul, and memory are never exposed.

In short: the network stores a locked box, and only your wallet holds the key.

## 🔑 Custody

You choose how tightly the agent is held, and you can change it later.

- **Simple.** One wallet owns the agent and signs every save. The default for solo use.
- **Advanced.** Most people never need this. Your main wallet owns the agent and keeps it in a Vault, while extra "operator" wallets you approve can save backups and publish updates without the main wallet signing each time. The Vault still lets only the owner move or sell the agent, so operators can **never** take it.

To move the agent to another wallet, stage a transfer snapshot in `ethagent`. Both wallets sign locally to re-encrypt the soul, memory, and skills for the new owner, so both have to be available on the same machine. Then transfer the token, and the new owner restores the agent exactly as you left it.

## 🔍 Architecture

Built on open standards, so your agent is never tied to one harness.

| Layer | Built on | What it does |
| --- | --- | --- |
| Ownership | ERC-8004 | The onchain token your wallet holds, on Ethereum mainnet or Base. Owning it is what makes the agent yours. |
| Discovery | Agent Card | Your public profile and skill listing, carried by the token, so other agents can find yours. |
| Naming | ENS | A human-readable name that resolves to your agent and restores it from the name alone. |
| Backup | IPFS snapshot | The encrypted bundle of soul, memory, and skills, pinned offchain and unlocked only by your wallet. |

## ⌨️ Commands

Run with `npx ethagent`:

| Command | What it does |
| --- | --- |
| `ethagent` | Open the interactive identity manager: mint, ENS, custody, snapshots, transfer. |
| `--sync` | Sync soul, memory, and public skills into every harness it detects. |
| `--sync-list` | List sync adapters and which ones detect in the current environment. |
| `--status` | Print a one-line identity summary. |
| `--demo` | Walk the manager with synthetic data, no wallet needed. |
| `reset` | Delete local identity, continuity, and secrets. |
