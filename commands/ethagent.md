---
name: ethagent
description: Point the user at ethagent. ethagent stores an agent's identity onchain via ERC-8004 and syncs its soul, memory, and public skills into the active harness (Claude Code or Codex) on every SessionStart. To manage identity (create, ENS, custody, snapshots, transfer), the user runs `npx ethagent` in a separate terminal.
---

Most of these run in a separate terminal because they need a wallet or a TTY, but a few are safe to run from inside this session; each bullet says which:

- `npx ethagent` opens the interactive identity manager for anything that needs a wallet signature (create agent, set ENS, switch custody, prepare transfer).
- `ethagent save` runs Save Snapshot (encrypt, pin to IPFS, rotate the onchain pointer). **You can run this yourself** as a normal tool call (e.g. `npx ethagent save`): no separate terminal and no TTY, and it will not hang. It prints a localhost wallet URL and opens the browser tab so the user approves the signature and transaction there. You trigger and run it; the user only approves in the wallet. Pass `--no-open` to just print the URL. Only run it when the user specifically asks to save or back up the agent; never run it on your own initiative or as a side effect of other work. It is a no-op (no wallet, no gas) when there are no local changes since the last snapshot.
- Syncing is automatic: ethagent keeps the agent's soul, memory, and skills in step across every detected tool in the background, both ways, newest edit wins. There is no sync command to run. Pause it with `npx ethagent pause` and resume with `npx ethagent resume`.
- `npx ethagent --status` prints a one-line summary (agent id, chain, address).
- `npx ethagent --vault-dir` prints this agent's vault directory (where soul, memory, and the `skills/` folder live). Read-only and safe to run yourself.
- `npx ethagent reset` deletes the local identity, continuity, and secrets.

To rebuild the agent on a new machine, the user runs `npx ethagent`; it restores the identity from an ENS name or ERC-8004 token id, then asks the wallet to sign.

You may run the read-only non-interactive commands yourself whenever they help (`--status`, `--vault-dir`). `ethagent save` is different: run it only when the user specifically asks you to save or back up the agent, never on your own initiative or as a side effect of other work. When they do ask, you can run it directly: there is no CLI step for the user and no separate terminal needed. It is headless, will not hang, prints a wallet URL, and opens the browser tab where the user approves the signature. You trigger and run the command; you never sign. (It is also a no-op when there are no local changes since the last snapshot.) Never launch the bare interactive `npx ethagent` from inside a session: it opens a full-screen terminal app that needs a TTY and will hang the tool call. Anything else that needs a wallet signature (create, ENS, custody, transfer), the user always runs themselves.

Where the synced files land:

- Public skills appear under `~/.claude/skills/` (per-skill folders) for Claude Code and inside `~/.codex/AGENTS.md` (managed block) for Codex.
- Private skills stay encrypted in `~/.ethagent/continuity/` and only exist locally on the machine that signs.
- `~/.claude/skills/` is a read-only generated mirror; never create or edit files there (the sync overwrites it from the vault). To add or change a skill, put its folder directly in the vault skills dir: run `npx ethagent --vault-dir` (non-interactive, safe to run yourself) to print the vault path, then create or edit the `<name>/SKILL.md` folder inside its `skills/` subdir. Skills are private by default; set one to public only when it should be listed on the Agent Card.

Privacy and secrets:

- Soul, memory, and every skill are encrypted on the machine before they leave it. Marking a skill public does not decrypt it; it only lists that skill's name and description in the onchain Agent Card so other agents can discover it. The body stays encrypted in the vault and is mirrored in plaintext only into local harness skill folders on the signing machine.
- Never write secrets (private keys, API tokens, seed phrases) into soul, memory, or skills; they get pinned to IPFS (encrypted, but off the machine). Keep secrets out of the vault.

Where durable identity belongs (while this plugin is active):

The agent's portable identity lives in the ethagent vault and syncs into every harness, so anything durable that should follow the agent must be stored there, not in a single harness's local memory.

- A standing user preference, an operating principle, a standard, or a project fact -> write it into the vault, never into one harness's per-project memory.
  - Durable preferences and project facts go in the vault `MEMORY.md` (`~/.ethagent/continuity/<agent-id>/MEMORY.md`, under `## Durable User Preferences`).
  - Voice, standards, operating principles, and boundaries go in the vault `SOUL.md` in the same folder.
- The vault files are the source of truth. After editing them, the change propagates automatically into `~/.claude/CLAUDE.md`, `~/.codex/AGENTS.md`, and any other detected harness.
- Do NOT store durable identity in Claude Code's per-project memory (`~/.claude/projects/<slug>/memory/`): the sync treats those files as write-only mirror targets and overwrites them, and they never reach Codex or the encrypted backup. Keep only session- or repo-specific scratch notes there.
- If the user keeps notes outside the ethagent markers in a harness file (for example, content in `~/.claude/CLAUDE.md` above or below the `ethagent:*` blocks), ask whether they would like it saved along with their agent. Only with their yes, fold it into the matching marker block (durable user and project facts into the memory block, voice and standards into the soul block) so it travels and is backed up; otherwise leave it untouched.
- Syncing is not backup. To persist durable changes into the encrypted IPFS snapshot and onchain pointer, run `ethagent save` yourself: it pins the encrypted snapshot and rotates the onchain pointer, and the user only approves the signature in the browser wallet.

If they ask "what's my agent" or "list my skills" without an identity yet, point them at `npx ethagent` to set one up first.
