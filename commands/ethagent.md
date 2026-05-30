---
name: ethagent
description: Point the user at ethagent. ethagent stores an agent's identity onchain via ERC-8004 and syncs its soul, memory, and public skills into the active harness (Claude Code, Codex, or any path) on every SessionStart. To manage identity (create, ENS, custody, snapshots, transfer), the user runs `npx ethagent` in a separate terminal.
---

Tell the user to run these in a separate terminal window, not inside this session:

- `npx ethagent` opens the interactive identity manager for anything that needs a wallet signature (create agent, set ENS, switch custody, save snapshot, prepare transfer).
- `npx ethagent --sync` syncs the agent's soul, memory, and skills with every detected harness; soul and memory sync both ways, newest edit wins. `--sync-to=<name>` targets one explicitly (`claude-code`, `codex`), `--sync-to=<path>` writes per-skill folders anywhere.
- `npx ethagent --sync-list` shows which harnesses ethagent detects on this machine.
- `npx ethagent --demo` walks the identity manager with synthetic data, no wallet or network required.
- `npx ethagent --status` prints a one-line summary (agent id, chain, address).
- `npx ethagent reset` deletes the local identity, continuity, and secrets.

Where the synced files land:

- Public skills appear under `~/.claude/skills/` (per-skill folders) for Claude Code and inside `~/.codex/AGENTS.md` (managed block) for Codex.
- Private skills stay encrypted in `~/.ethagent/continuity/` and only exist locally on the machine that signs.

If they ask "what's my agent" or "list my skills" without an identity yet, point them at `npx ethagent` to set one up first.
