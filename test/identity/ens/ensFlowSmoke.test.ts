import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

function sourceFilesUnder(dir: string): string[] {
  if (!existsSync(dir)) return []
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return sourceFilesUnder(path)
    return entry.isFile() && /\.(ts|tsx)$/.test(entry.name) ? [path] : []
  })
}

function ensEditFlowText(): string {
  return sourceFilesUnder('src/identity/manager/ens')
    .filter(file => /[\\/]EnsEdit|[\\/]editCopy\.ts$/.test(file))
    .map(file => readFileSync(file, 'utf8'))
    .join('\n')
}

function walletPageText(): string {
  return sourceFilesUnder('src/identity/wallet/page')
    .map(file => readFileSync(file, 'utf8'))
    .join('\n')
}

test('ERC-8004 identity registry path does not encode token approval or transfer calls', () => {
  const source = readFileSync('src/identity/registry/erc8004.ts', 'utf8')

  assert.doesNotMatch(source, /function\s+(approve|setApprovalForAll|transferFrom|safeTransferFrom)\b/)
  assert.doesNotMatch(source, /functionName:\s*['"](approve|setApprovalForAll|transferFrom|safeTransferFrom)['"]/)
})

test('setup-facing wallet copy uses owner/operator wallet language', () => {
  const walletPage = walletPageText()
  const editFlow = ensEditFlowText()
  const operators = readFileSync('src/identity/manager/ens/EnsOperatorWalletsScreen.tsx', 'utf8')
  const restoreFlow = readFileSync('src/identity/manager/restore/RestoreFlow.tsx', 'utf8')
  const identityManager = readFileSync('src/identity/manager/IdentityManager.tsx', 'utf8')
  const visibleCopy = [walletPage, editFlow, operators, restoreFlow, identityManager].join('\n')

  assert.match(walletPage, /Owner Wallet Required/)
  assert.match(walletPage, /Operator Wallet Required/)
  assert.match(walletPage, /Sign With Owner Wallet/)
  assert.match(walletPage, /Sign With Operator Wallet/)
  assert.match(restoreFlow, /Agent Search Incomplete/)
  assert.doesNotMatch(visibleCopy, /Agent lookup is taking too long/)
})

test('refactored identity wallet and effects files do not contain mojibake text', () => {
  const files = [
    ...sourceFilesUnder('src/identity/wallet'),
    ...sourceFilesUnder('src/identity/manager/shared/effects'),
    ...sourceFilesUnder('src/identity/manager/shared/reconciliation'),
    ...sourceFilesUnder('src/identity/manager/ens'),
  ]
  const text = files.map(file => readFileSync(file, 'utf8')).join('\n')

  assert.doesNotMatch(text, new RegExp('[\\u00c2\\u00c3\\ufffd]'))
})

test('Identity Manager advanced ENS flow remains compact and focused', () => {
  const editFlow = ensEditFlowText()
  const operators = readFileSync('src/identity/manager/ens/EnsOperatorWalletsScreen.tsx', 'utf8')
  const transferFlow = readFileSync('src/identity/manager/transfer/TokenTransferScreens.tsx', 'utf8')

  assert.match(editFlow, /title="ENS Name"/)
  assert.match(editFlow, /Current Setup/)
  assert.match(transferFlow, /title="Prepare Token Transfer"/)
  assert.match(editFlow, /agent subdomain|agent ENS name/i)
  assert.doesNotMatch(editFlow, /org\.ethagent\.operator/)
  assert.match(operators, /label: 'Operator Wallets'/)
  assert.match(operators, /label: 'Add Wallet'/)
  assert.match(operators, /Unlink \$\{shortAddress\(record\.address\)\}/)
  assert.match(operators, /Unlink All Operator Wallets/)
  assert.match(operators, /removeApprovedOperatorWallet\(records, address\)/)
  assert.match(operators, /Verify Operator/)
  assert.match(operators, /FlowTimeline/)
  assert.doesNotMatch(operators, /Sync ENS Operator Wallet|Metadata Operators/)
  assert.doesNotMatch(operators, /Paste Wallet Proof/)
  assert.doesNotMatch(editFlow, /FlowTimeline/)
  assert.doesNotMatch(editFlow, /SIMPLE_ENS_STEPS|ADVANCED_ENS_STEPS/)
})

test('Identity Manager token transfer copy keeps approvals out of the flow', () => {
  const menu = readFileSync('src/identity/manager/shared/components/MenuScreen.tsx', 'utf8')
  const guide = readFileSync('src/identity/manager/transfer/TokenTransferScreens.tsx', 'utf8')
  const effects = readFileSync('src/identity/manager/transfer/progress.ts', 'utf8')

  assert.match(menu, /Prepare Transfer/)
  assert.match(guide, /Transfer the token externally, then restore with the receiver wallet\./)
  assert.match(effects, /title: 'Use Receiver Wallet'/)
  assert.match(effects, /title: 'Use Sender Wallet Again'/)
  assert.match(guide, /No token approval is requested\./)
})

test('identity copy uses onchain spelling', () => {
  const files = [
    'README.md',
    'src/identity/ens/ensLookup.ts',
    'src/identity/manager/ens/transactions.ts',
    'src/identity/manager/continuity/effects.ts',
    'src/identity/manager/continuity/RecoveryConfirmScreen.tsx',
    'src/identity/manager/transfer/TokenTransferScreens.tsx',
  ]
  const text = files.map(file => readFileSync(file, 'utf8')).join('\n')

  assert.doesNotMatch(text, new RegExp('on' + '-chain', 'i'))
  assert.doesNotMatch(text, /\bon chain\b/i)
  assert.match(text, /onchain/i)
})

test('vaulted public profile saves do not require Ethereum Mainnet ENS writes', () => {
  const publicProfile = readFileSync('src/identity/manager/profile/effects.ts', 'utf8')
  const vaultFlow = publicProfile.slice(
    publicProfile.indexOf('async function runOperatorWalletVaultPublicProfileSave'),
    publicProfile.indexOf('type OperatorProfileArtifacts'),
  )

  assert.match(vaultFlow, /encodeRotateAgentURI/)
  assert.match(vaultFlow, /rotate-agent-uri-vault-operator/)
  assert.doesNotMatch(vaultFlow, /publishOperatorProfileEnsRecord/)
  assert.doesNotMatch(vaultFlow, /runUpdateEnsRecords/)
  assert.match(vaultFlow, /Profile updated\. ERC-8004 metadata published through the Vault\./)
})

test('public profile completion feedback starts capitalized', () => {
  const publicProfile = readFileSync('src/identity/manager/profile/effects.ts', 'utf8')

  assert.doesNotMatch(publicProfile, /'profile updated/)
  assert.match(publicProfile, /'Profile updated/)
})

test('operator profile updates never write to ENS', () => {
  const publicProfile = readFileSync('src/identity/manager/profile/effects.ts', 'utf8')
  const walletCopy = walletPageText()

  assert.doesNotMatch(publicProfile, /publishOperatorProfileEnsRecord/)
  assert.doesNotMatch(publicProfile, /runUpdateEnsRecords/)
  assert.doesNotMatch(publicProfile, /org\.ethagent\.profile/)

  const operatorCopy = walletCopy.slice(
    walletCopy.indexOf('"update-profile-operator"'),
    walletCopy.indexOf('"update-profile-connected"'),
  )
  assert.match(operatorCopy, /No ENS write/)
  assert.doesNotMatch(operatorCopy, /ENS record|ENS name/i)
})

test('README documents core-file sync, custody modes, ENS naming, and transfer', () => {
  const readme = readFileSync('README.md', 'utf8')

  assert.match(readme, /Using your agent/)
  assert.match(readme, /plugin install ethagent/)
  assert.match(readme, /wires itself into/)
  assert.match(readme, /in the background/i)
  assert.match(readme, /Save Snapshot/)
  assert.match(readme, /Custody/)
  assert.match(readme, /\*\*Simple\.\*\*/)
  assert.match(readme, /keeps it in a Vault/)
  assert.match(readme, /operators can \*\*never\*\* take it/)
  assert.match(readme, /ENS name you own/)
  assert.match(readme, /by ENS name or token id/)
  assert.match(readme, /transfer the token, and the new owner/)
})
