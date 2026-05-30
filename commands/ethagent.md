---
name: ethagent
description: Point the user at ethagent. ethagent stores an agent's identity onchain via ERC-8004 and syncs its soul, memory, and public skills into the active harness (Claude Code or Codex) on every SessionStart. To manage identity (create, ENS, custody, snapshots, transfer), the user runs `npx ethagent` in a separate terminal.
---

Tell the user to run these in a separate terminal window, not inside this session:

- `npx ethagent` opens the interactive identity manager for anything that needs a wallet signature (create agent, set ENS, switch custody, save snapshot, prepare transfer).
- `npx ethagent --sync` syncs the agent's soul, memory, and skills with every detected harness; soul and memory sync both ways, newest edit wins.
- `npx ethagent --sync-list` shows which harnesses ethagent detects on this machine.
- `npx ethagent --demo` walks the identity manager with synthetic data, no wallet or network required.
- `npx ethagent --status` prints a one-line summary (agent id, chain, address).
- `npx ethagent reset` deletes the local identity, continuity, and secrets.

To rebuild the agent on a new machine, the user runs `npx ethagent`; it restores the identity from an ENS name or ERC-8004 token id, then asks the wallet to sign.

You may run the non-interactive flags yourself when it helps (`--sync`, `--status`, `--sync-list`). Never launch the bare interactive `npx ethagent` or `--demo` from inside a session: they open a full-screen terminal app that needs a TTY and will hang the tool call. Anything that needs a wallet signature, the user always runs themselves.

Where the synced files land:

- Public skills appear under `~/.claude/skills/` (per-skill folders) for Claude Code and inside `~/.codex/AGENTS.md` (managed block) for Codex.
- Private skills stay encrypted in `~/.ethagent/continuity/` and only exist locally on the machine that signs.

Privacy and secrets:

- Soul, memory, and every skill are encrypted on the machine before they leave it. Marking a skill public does not decrypt it; it only lists that skill's name and description in the onchain Agent Card so other agents can discover it. The body stays encrypted in the vault and is mirrored in plaintext only into local harness skill folders on the signing machine.
- Never write secrets (private keys, API tokens, seed phrases) into soul, memory, or skills; they get pinned to IPFS (encrypted, but off the machine). Keep secrets out of the vault.

Where durable identity belongs (while this plugin is active):

The agent's portable identity lives in the ethagent vault and syncs into every harness, so anything durable that should follow the agent must be stored there, not in a single harness's local memory.

- A standing user preference, an operating principle, a standard, or a project fact -> write it into the vault, never into one harness's per-project memory.
  - Durable preferences and project facts go in the vault `MEMORY.md` (`~/.ethagent/continuity/<agent-id>/MEMORY.md`, under `## Durable User Preferences`).
  - Voice, standards, operating principles, and boundaries go in the vault `SOUL.md` in the same folder.
- The vault files are the source of truth. After editing them, run `npx ethagent --sync` so the change propagates into `~/.claude/CLAUDE.md`, `~/.codex/AGENTS.md`, and any other detected harness.
- Do NOT store durable identity in Claude Code's per-project memory (`~/.claude/projects/<slug>/memory/`): the sync treats those files as write-only mirror targets and overwrites them, and they never reach Codex or the encrypted backup. Keep only session- or repo-specific scratch notes there.
- Syncing is not backup. To persist durable changes into the encrypted IPFS snapshot and onchain pointer, the user runs `npx ethagent` and chooses Save Snapshot (needs a wallet signature).

If they ask "what's my agent" or "list my skills" without an identity yet, point them at `npx ethagent` to set one up first.
