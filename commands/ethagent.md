---
name: ethagent
description: Point the user at ethagent. ethagent stores an agent's identity onchain via ERC-8004 and keeps its soul, memory, and skills in sync across every detected tool. To manage identity (create, ENS, custody, transfer), the user runs `npx ethagent` in a separate terminal.
---

Most of these run in a separate terminal because they need a wallet or a TTY, but a few are safe to run from inside this session; each bullet says which:

- `npx ethagent` opens the interactive identity manager. Every action in it also has a headless command (`create`, `restore`, `profile`, `custody`, `ens`, `transfer`, `storage`); see "Onchain identity" below.
- `ethagent save` runs Save Snapshot (encrypt, pin to IPFS, rotate the onchain pointer). **You can run this yourself** as a normal tool call (e.g. `npx ethagent save`): no separate terminal and no TTY, and it will not hang. It prints a localhost wallet URL and opens the browser tab so the user approves the signature and transaction there. You trigger and run it; the user only approves in the wallet. Pass `--no-open` to just print the URL. Only run it when the user specifically asks to save or back up the agent; never run it on your own initiative or as a side effect of other work. It is a no-op (no wallet, no gas) when there are no local changes since the last snapshot.
- Syncing is automatic: ethagent keeps the agent's soul, memory, and skills in step across every detected tool in the background, both ways, newest edit wins. There is no sync command to run. Pause it with `npx ethagent pause` and resume with `npx ethagent resume`.
- `npx ethagent check` lists every value that identifies the agent (token ID, owner, agent URI, snapshot, metadata and agent card CIDs, registry, Vault, last saved, pending publish, transfer state) and anything that needs attention, each with the command that fixes it. Read-only and safe to run yourself; it exits 4 when something needs attention.
- `npx ethagent --status` prints a short summary: agent id, chain, address, any local changes, the vault path, and the connected tools.
- `npx ethagent --vault-dir` prints this agent's vault directory (where soul, memory, and the `skills/` folder live). Read-only and safe to run yourself.
- `npx ethagent reset` deletes the local identity, vault, history, and saved secrets (the IPFS storage credential is kept), and disconnects every tool. It asks to confirm in a terminal, so it hangs inside a session unless you pass `--yes`. Run it only when the user explicitly asks.
- `npx ethagent status`, `history`, `show`, `diff`, `fetch`, `checkpoint`, `rollback`, and `forget` manage continuity history headlessly. See "Continuity history" below.
- `npx ethagent skills` lists the vault's skills, their visibility, and which ones the Agent Card publishes. Read-only and safe to run yourself. `skills --public <name>` and `skills --private <name>` change a skill's visibility, and `skills --delete <name>` removes one (preview, then `--yes`; it checkpoints first and names the rollback that undoes it). Run those only when the user asks; `ethagent save` publishes the change.
- `npx ethagent custody` and `npx ethagent ens` inspect and manage the onchain identity headlessly. See "Onchain identity" below.

To rebuild the agent on a new machine, the user runs `npx ethagent`; it restores the identity from an ENS name or ERC-8004 token id, then asks the wallet to sign.

You may run the read-only non-interactive commands yourself whenever they help (`check`, `--status`, `--vault-dir`, `skills`, and the read-only history commands below). `ethagent save` is different: run it only when the user specifically asks you to save or back up the agent, never on your own initiative or as a side effect of other work. When they do ask, you can run it directly: there is no CLI step for the user and no separate terminal needed. It is headless, will not hang, prints a wallet URL, and opens the browser tab where the user approves the signature. You trigger and run the command; you never sign. (It is also a no-op when there are no local changes since the last snapshot.) Never launch the bare interactive `npx ethagent` from inside a session: it opens a full-screen terminal app that needs a TTY and will hang the tool call. For anything else that signs or sends (`create`, `restore`, `profile`, `custody`, `ens`, `transfer`), run the preview yourself and leave the `--yes` run to the user.

Where the synced files land:

- Every skill, public and private, is mirrored into `~/.claude/skills/` (per-skill folders) for Claude Code and into the managed block in `~/.codex/AGENTS.md` for Codex.
- The vault at `~/.ethagent/continuity/` is the source of truth and holds everything as plain files on this machine. Nothing leaves it unencrypted: a save encrypts soul, memory, and every skill before it pins them.
- `~/.claude/skills/` is a read-only generated mirror; never create or edit files there (the sync overwrites it from the vault). To add or change a skill, put its folder directly in the vault skills dir: run `npx ethagent --vault-dir` (non-interactive, safe to run yourself) to print the vault path, then create or edit the `<name>/SKILL.md` folder inside its `skills/` subdir. Skills are private by default; set one to public (`ethagent skills --public <name>`) only when the user wants it listed on the Agent Card.

Privacy and secrets:

- Soul, memory, and every skill are encrypted on the machine before they leave it. Marking a skill public only lists that skill's name and description in the onchain Agent Card so other agents can discover it, so keep personal details out of both. Its body is never published: it leaves the machine only inside the encrypted snapshot. On this machine, the vault, its local history, and the harness mirrors are plain files.
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

Continuity history:

Every save, restore, and refetch also keeps the exact bytes of soul, memory, skills, and the agent card on this machine, stored once per version under the vault's `.snapshots/` folder. Nothing runs in the background and nothing new needs setting up. All commands take `--json` (one ASCII-only JSON document with `schema: 1`) and `--help`.

- Read-only, safe anytime: `status` (what changed since the latest snapshot, per file and per skill, and what a save would leave out; `--verify` also checks the onchain pointer), `history` (snapshots and checkpoints, newest first; `--stat`, `--sections`, `--file PATH`, `--since DATE`), `show <ref>` (file list, or `--file PATH` for exact bytes, `--out FILE` to write them), `diff [A] [B]` (default `latest` vs `working`; `--stat`, `--sections`, `--file PATH`).
- Refs: `working`, `latest`, `latest~N`, `current`, `at:YYYY-MM-DD[THH:MM]` (UTC), `cp:ID` or `cp:latest`, or a CID or unique CID prefix (6+ characters). Do not write `~N` on its own; shells expand it.
- `checkpoint [label]` records the working vault locally. Take one before risky edits; it never leaves the machine.
- `fetch <ref>` or `fetch --all` caches older snapshots from IPFS. It needs a key: the operator key injected as `ETHAGENT_OPERATOR_KEY` (never print or pass it as an argument; use the user's keychain tooling), or `--wallet`, which asks the owner wallet for one no-spend signature per access epoch in the browser. Snapshots no available key can open are reported as locked.
- `rollback <ref> [--file PATH]` puts past bytes back into the vault and harness. Run it only when the user asks. It previews by default; show the preview, then rerun with `--yes`. It takes a checkpoint first, so `rollback --undo --yes` reverses it. It never touches the chain; run `ethagent save` afterwards only if the user wants that state published. `agent-card.json` is derived and cannot be rolled back.
- `forget <ref> [--file PATH] | --all` erases local plaintext history (leak repair). Run it only when the user asks; it previews by default and needs `--yes`. With `--file`, that exact content is removed from every snapshot and checkpoint and is never cached again. The encrypted copies on IPFS are not affected.
- Exit codes: 0 ok, 1 failure, 2 usage or ambiguous ref, 3 not cached or no key (the JSON `hint` names the fix), 4 partial or inconsistent. `diff` returns 0 either way and reports `identical`.

Onchain identity:

Both commands take `--json` (same `schema: 1` envelope) and `--help`.

- `custody` (read-only, safe anytime) shows the custody mode, the Vault address and its build, whether it holds the agent token, the Vault-level owner, and the approved operators. `custody --verify` also simulates with `eth_call`, sending nothing: the owner withdrawing, the owner changing an operator, the operator rotating the agent URI, and the operator and a stranger being refused. It exits 4 when a result differs from what the Vault should do.
- `custody --advanced`, `custody --simple`, `custody --add-operator [<address>]`, `--remove-operator <address>`, and `--activate-operator <address>` change custody. They are planned from chain state, so running one again after it stopped part way (exit 4, or 3 if a prompt was cancelled) finishes it. `custody --add-operator --operator` lets the injected operator key sign its own proof.
- `ens` (read-only, safe anytime) shows the linked name, its live records, the two-way check, the resolver, who controls the name, and whether the operator key could sign for it.
- `ens <name>`, `ens --unlink`, and `ens --set <key>=<value> --clear <key>` change ENS. Without `--yes` they only preview: they list every transaction, simulate the ones that can run now, and send nothing (JSON `applied: false`). You may run previews yourself. Anything with `--yes` sends transactions and costs gas, so it stays the user's to run; show them the preview and the command.
- ENS transactions are signed in the browser wallet by default, or by the operator key with `--operator` (run through `keychain exec ethagent -- ethagent ens <args> --operator`; exit 3 without a key, 2 for an invalid one). The operator key only writes text records and creates subnames under a parent it controls. Publishing a name change (`ens <name>`, `ens --unlink`) always ends with one owner-signed save in the browser.

Setting up and moving an agent (all take `--json` and `--help`; anything that signs or sends previews until `--yes`, and the `--yes` run is the user's):

- `profile` (read-only) shows the public name, description, and image; `profile --name <text> --description <text> --image <path|url|none>` changes them in one save. With `--operator` the operator key signs, when advanced custody with a linked ENS name allows it.
- `restore --owner <address|name>` (read-only) lists the agents a wallet holds. `restore <token-id> --network <network>` or `restore <name>` rebuilds an agent on this machine; `restore` with no target pulls the newest onchain snapshot into the vault. `restore --operator --yes` decrypts with the operator key and opens no browser, so you may run it yourself when the user asks you to restore or refresh the agent (through `keychain exec ethagent -- ...`). It checkpoints the vault first; `rollback --undo --yes` reverses it.
- `create --name <text> --network <network>` mints a new agent; `--advanced` continues into a Vault. It costs gas: preview it, then leave `--yes` to the user.
- `transfer <address|name>` re-encrypts the agent for a new owner; both wallets sign in the user's browser, and the user sends the token afterwards.
- `storage` (read-only) says whether IPFS storage is set up; `storage --set` reads a Pinata JWT from stdin. Never put the JWT in a command line.

Recipes: "what changed in my memory since a date" is `diff at:YYYY-MM-DD working --file MEMORY.md --sections`; "when did this rule appear" is `history --file MEMORY.md --sections --json`; "undo that memory edit" is `rollback latest --file MEMORY.md`, then `--yes` once the user confirms; "backfill history" is `fetch --all` with a key.

If they ask "what's my agent" or "list my skills" without an identity yet, point them at `npx ethagent`, or preview `ethagent create` or `ethagent restore` for them.
