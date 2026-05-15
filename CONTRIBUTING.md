# Contributing

Keep changes narrow and behavior-preserving unless an issue or PR explicitly agrees to a behavior change.

## Workflow

1. Open or reference an issue for anything larger than a typo.
2. Keep each PR to one logical change.
3. Match nearby code style and avoid broad formatting churn.
4. Include the commands you ran in the PR description.

## Local Checks

Run these before opening a PR:

```bash
npm run build
npm test
```

`npm run build` is the release-facing validation build for this source-distributed CLI. It runs the same TypeScript check as `npm run typecheck` without emitting a `dist/` directory.

For contract changes, also run:

```bash
npm run contracts:test
```

On Windows PowerShell, use `cmd /c` if script execution policy blocks `npm`:

```bash
cmd /c npm run build
cmd /c npm test
```

## Refactoring Rules

- Preserve exported symbols and existing import paths unless the PR is explicitly about an API change.
- Do not change config, storage, continuity envelope, metadata, or contract wire shapes during cleanup.
- Prefer extracting private helpers behind the current module facade over moving call sites across the repo.
- Keep composition roots as coordinators only; when rendering, protocol shaping, persistence, or process control start mixing together, split the private concern into a sibling helper.
- Add or keep focused tests around moved logic before changing structure.
- Avoid dependency upgrades, formatter introductions, and repository-wide reformatting in refactor PRs.

## File Naming

- Use `PascalCase.tsx` for React/Ink components and screen modules.
- Use `camelCase.ts` or role names such as `state.ts`, `types.ts`, and `effects.ts` for helper modules.
- Keep sibling extraction names aligned with the kind of module being extracted; a helper split from `ModelPicker.tsx` should read like `modelPickerData.ts`, not another component file.
