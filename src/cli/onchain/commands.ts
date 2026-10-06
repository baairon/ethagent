// Onchain identity commands. They load lazily, next to the history verbs, before
// --help and bootstrap.
export const ONCHAIN_COMMANDS = new Set(['custody', 'ens', 'restore', 'profile', 'create', 'storage', 'transfer', 'check'])
