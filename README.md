<p align="center">
  <img src="preview/image.svg" alt="ethagent" width="100%">
</p>

You don't really own your AI agent. It lives on a platform you don't control, and it stays there the day you leave.

ethagent gives it a portable identity instead: a token you hold in your wallet, not an account on someone else's server. Hold the token and you hold the agent.

Its soul, memory, and skills travel with it, encrypted and restored on any machine exactly as you left it. No platform can revoke it. No company can read it. Nobody can lock you out.

Own your agent. Carry it anywhere.

## Quick start

**1. Create your agent.** In a terminal, run:

```bash
npx ethagent
```

You'll need an Ethereum wallet with funds for gas. Creating your agent and saving backups are onchain steps; editing it in between is free.

A guided menu does the rest: create its token, give it a name, and write who it is. Your wallet signs each step.

**2. Add it to Claude Code.** Paste these in once:

```
/plugin marketplace add baairon/ethagent
/plugin install ethagent@ethagent
/reload-plugins
```

**3. Talk to your agent.** From here on it shows up in every session and gets to know you as you go.

That's the whole setup. Come back to ethagent only to edit your agent by hand or back it up.

## Three files you shape

- **Soul** (`SOUL.md`): who it is, your standards, your voice, the way you work.
- **Memory** (`MEMORY.md`): what it has learned about you, your preferences, and your projects, so context survives the move to a new machine.
- **Skills:** the commands, tools, and prompts you teach it. Public by default, so other agents can discover them; mark one private to keep it off your public Agent Card (the profile your token publishes).

You grow these mostly by talking: with the plugin on, your agent updates its own soul and memory as you converse, and the changes sync automatically. To edit them by hand, open ethagent.

## How it works

1. **Own it.** Your wallet holds an ERC-8004 token; that token, not a platform account, is the agent.
2. **Configure it.** Shape its soul, memory, and skills under an ENS name you own.
3. **Save it.** ethagent encrypts everything locally, pins the ciphertext to IPFS (Pinata by default, or your own node), and rotates a pointer in your token onchain. The host only ever sees ciphertext; only your wallet can unlock it.
4. **Restore it.** On any machine, ethagent reads the pointer, asks your wallet to sign, then fetches and decrypts the snapshot to rebuild your agent, found by ENS name or token id.

## Across your tools

With the Claude Code plugin this is automatic: every session your agent shows up already up to date, and anything it learns gets saved back. Nothing to set up.

On any other tool, one command brings your agent in:

```bash
npx ethagent --sync
```

It copies your agent's latest self, its soul, memory, and skills, into whatever tools you have, and `npx ethagent --sync-list` shows which ones it found.

If your tool has lifecycle hooks, point its session-start hook at `npx ethagent --sync` (and an after-edit hook too, if it has one) so it stays current on its own, the way the Claude Code plugin does.

Sync is not backup. Sync only updates files on the machine you're already on; nothing leaves it until you save. So if you switch machines before saving, the unsaved changes don't come with you. To keep them, open ethagent, choose **Save Snapshot**, and sign.

## What stays private

Everything is encrypted on your machine before it leaves: `SOUL.md`, `MEMORY.md`, and every skill.

- The encryption keys come from a wallet signature ethagent never sees. Signing it costs no gas and moves no funds. (Saving a snapshot is separate: it rotates your token's onchain pointer, a normal transaction you pay gas for.)
- A public skill is **not** decrypted. The Agent Card on your token publishes your agent's profile (name, description, optional image), each public skill's name and description, and your owner wallet (already public as the token holder).
- Private skills, soul, and memory are never exposed.

In short: the network stores a locked box, and only your wallet holds the key.

## Custody

You choose how tightly the agent is held, and you can change it later.

- **Simple.** One wallet owns the agent and signs every save. The default for solo use.
- **Advanced.** Most people never need this. An owner wallet holds the agent in a Vault, and operator wallets can save snapshots and publish updates without the owner's signature. The Vault is a contract that gates transfers to the owner alone, so operators can **never** move or sell your agent.

To move the agent to another wallet, stage a transfer snapshot in ethagent. Both wallets sign locally to re-encrypt the soul, memory, and skills for the new owner, so both have to be available on the same machine. Then transfer the token, and the new owner restores the agent exactly as you left it.

## Architecture

Built on open standards, so your agent is never tied to one tool.

| Layer | Built on | What it does |
| --- | --- | --- |
| Ownership | ERC-8004 | The onchain token your wallet holds. Owning it is what makes the agent yours. |
| Discovery | Agent Card | Your public profile and skill listing, carried by the token, so other agents can find yours. |
| Naming | ENS | A human-readable name that resolves to your agent and restores it from the name alone. |
| Backup | IPFS snapshot | The encrypted bundle of soul, memory, and skills, pinned offchain and unlocked only by your wallet. |

## Commands

Run with `npx ethagent`:

| Command | What it does |
| --- | --- |
| `ethagent` | Open the interactive identity manager: mint, ENS, custody, snapshots, transfer. |
| `--sync` | Sync soul, memory, and public skills into every tool it detects. |
| `--sync-to=<target>` | Sync to one tool by name (`codex`, `claude-code`), or write public skills into a folder path. |
| `--sync-list` | List sync adapters and which ones detect in the current environment. |
| `--status` | Print a one-line identity summary. |
| `--demo` | Walk the manager with synthetic data, no wallet needed. |
| `reset` | Delete local identity, continuity, and secrets. |
