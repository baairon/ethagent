# Architecture

`ethagent` is a TypeScript Node CLI with an Ink terminal UI, provider adapters, local workspace tools, and Ethereum identity/continuity flows.

## Main Areas

- `src/cli`: process entrypoints, reset flow, preview, and terminal title setup.
- `src/app`: first-run flow, input parsing, hooks, and keybinding context.
- `src/chat`: chat screen, transcript rendering, slash commands, and turn orchestration.
- `src/runtime`: model turn loop, tool execution, session mode policy, context compaction, and system prompt assembly.
- `src/providers`: OpenAI, Anthropic, Gemini, local OpenAI-compatible, and Responses API adapters.
- `src/models`: model catalog, picker UI, local llama.cpp setup, and Hugging Face GGUF discovery.
- `src/tools`: workspace tools, permission rules, diffs, MCP resource tools, and tool registry.
- `src/storage`: local config, sessions, secrets, history, rewind, permissions, and atomic writes.
- `src/identity`: wallet bridge, ERC-8004 registry integration, ENS, continuity snapshots, Identity Hub, recovery, custody, and transfer flows.
- `src/ui`: shared Ink primitives and theme constants.
- `contracts`: Foundry vault contract, deployment script, and Solidity tests.

## Boundaries

- Runtime and chat own conversation flow; tools should not mutate chat state directly.
- Providers normalize remote streams into the shared provider contracts; UI code should not depend on provider-specific payloads.
- Identity storage, continuity envelopes, ERC-8004 metadata, and wallet request payloads are compatibility surfaces. Treat shape changes as behavior changes.
- Large UI and orchestration modules should keep stable public exports while moving private helpers into focused sibling modules.
- Browser wallet HTML is generated from source files through `browserWallet/walletPageSource.ts`; keep its source list centralized.

## Module Shape

- Stable facades preserve import paths for compatibility-sensitive areas such as provider adapters, continuity envelopes, local-runner management, and MCP runtime entrypoints.
- Composition roots may stay larger when they only coordinate already-focused modules; extract code once a file starts mixing rendering, policy, protocol shaping, persistence, or process control.
- New helper modules should live beside the facade they support and use names that describe their responsibility, for example credential flows, discovery, row state, or crypto helpers.

## Build And Packaging

- The npm package is source-distributed: `bin/ethagent.js` starts `src/cli/main.tsx` through `tsx`.
- `npm run build` is a validation build over the shipped TypeScript source and intentionally emits no `dist/` directory.
- `npm pack` includes `bin`, `src`, `README.md`, and `LICENSE`; the `prepack` hook runs the validation build first.

## Testing Map

- Chat/runtime changes: run the chat and runtime tests.
- Provider/model changes: run provider, model catalog, Hugging Face, and llama.cpp tests.
- Identity changes: run Identity Hub, ENS, wallet, continuity, registry, and storage tests.
- Contract changes: run Foundry tests through `npm run contracts:test`.
