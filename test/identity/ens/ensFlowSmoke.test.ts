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
  return sourceFilesUnder('src/identity/hub/ens')
    .filter(file => /[\\/]EnsEdit|[\\/]editCopy\.ts$/.test(file))
    .map(file => readFileSync(file, 'utf8'))
    .join('\n')
}

test('ERC-8004 identity registry path does not encode token approval or transfer calls', () => {
  const source = readFileSync('src/identity/registry/erc8004.ts', 'utf8')

  assert.doesNotMatch(source, /function\s+(approve|setApprovalForAll|transferFrom|safeTransferFrom)\b/)
  assert.doesNotMatch(source, /functionName:\s*['"](approve|setApprovalForAll|transferFrom|safeTransferFrom)['"]/)
})

test('setup-facing wallet copy uses owner/operator wallet language', () => {
  const walletPage = [
    readFileSync('src/identity/wallet/page.tsx', 'utf8'),
    readFileSync('src/identity/wallet/page/copy.ts', 'utf8'),
  ].join('\n')
  const editFlow = ensEditFlowText()
  const operators = readFileSync('src/identity/hub/ens/EnsOperatorWalletsScreen.tsx', 'utf8')
  const restoreFlow = readFileSync('src/identity/hub/restore/RestoreFlow.tsx', 'utf8')
  const identityHub = readFileSync('src/identity/hub/IdentityHub.tsx', 'utf8')
  const visibleCopy = [walletPage, editFlow, operators, restoreFlow, identityHub].join('\n')

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
    ...sourceFilesUnder('src/identity/hub/shared/effects'),
    ...sourceFilesUnder('src/identity/hub/shared/reconciliation'),
    ...sourceFilesUnder('src/identity/hub/ens'),
  ]
  const text = files.map(file => readFileSync(file, 'utf8')).join('\n')

  assert.doesNotMatch(text, new RegExp('[\\u00c2\\u00c3\\ufffd]'))
})

test('Identity Hub advanced ENS flow remains compact and focused', () => {
  const editFlow = ensEditFlowText()
  const operators = readFileSync('src/identity/hub/ens/EnsOperatorWalletsScreen.tsx', 'utf8')
  const transferFlow = readFileSync('src/identity/hub/transfer/TokenTransferScreens.tsx', 'utf8')

  assert.match(editFlow, /title="ENS Name"/)
  assert.match(editFlow, /Current Setup/)
  assert.match(transferFlow, /title="Prepare Token Transfer"/)
  assert.match(editFlow, /dedicated agent subdomain|agent ENS name/)
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

test('Identity Hub token transfer copy keeps approvals out of the flow', () => {
  const menu = readFileSync('src/identity/hub/shared/components/MenuScreen.tsx', 'utf8')
  const guide = readFileSync('src/identity/hub/transfer/TokenTransferScreens.tsx', 'utf8')
  const effects = readFileSync('src/identity/hub/transfer/progress.ts', 'utf8')

  assert.match(menu, /Prepare Transfer/)
  assert.match(guide, /Use this before any ERC-8004 token transfer\./)
  assert.match(guide, /Both signed wallets can read this snapshot/)
  assert.match(effects, /title: 'Use Receiver Wallet'/)
  assert.match(effects, /title: 'Use Sender Wallet Again'/)
  assert.match(guide, /No approve\(\), setApprovalForAll\(\), transferFrom\(\), or token approval is requested/)
})

test('identity copy uses onchain spelling', () => {
  const files = [
    'README.md',
    'src/identity/ens/ensLookup.ts',
    'src/identity/hub/ens/transactions.ts',
    'src/identity/hub/continuity/effects.ts',
    'src/identity/hub/continuity/RecoveryConfirmScreen.tsx',
    'src/identity/hub/transfer/TokenTransferScreens.tsx',
  ]
  const text = files.map(file => readFileSync(file, 'utf8')).join('\n')

  assert.doesNotMatch(text, new RegExp('on' + '-chain', 'i'))
  assert.doesNotMatch(text, /\bon chain\b/i)
  assert.match(text, /onchain/i)
})

test('vaulted public profile saves do not require Ethereum Mainnet ENS writes', () => {
  const publicProfile = readFileSync('src/identity/hub/profile/effects.ts', 'utf8')
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
  const publicProfile = readFileSync('src/identity/hub/profile/effects.ts', 'utf8')

  assert.doesNotMatch(publicProfile, /'profile updated/)
  assert.match(publicProfile, /'Profile updated/)
})

test('operator profile updates never write to ENS', () => {
  const publicProfile = readFileSync('src/identity/hub/profile/effects.ts', 'utf8')
  const walletCopy = readFileSync('src/identity/wallet/page/copy.ts', 'utf8')

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

test('README documents custody modes, ENS, and token transfer flow', () => {
  const readme = readFileSync('README.md', 'utf8')

  assert.match(readme, /## Custody Modes/)
  assert.match(readme, /\*\*Simple\*\*/)
  assert.match(readme, /\*\*Advanced\*\* splits an owner wallet/)
  assert.match(readme, /never receive token approval or transfer rights/)
  assert.match(readme, /Subdomains live under a parent name you control, never on root `\.eth` names directly/)
  assert.match(readme, /token ID and network/)
  assert.match(readme, /\*\*Switch Agent\*\* accepts an ENS name or an ERC-8004 token ID/)
  assert.match(readme, /## Token Transfers/)
  assert.match(readme, /Prepare Token Transfer.*before any ERC-8004 token transfer/)
  assert.match(readme, /sender signs snapshot access, receiver signs restore access/i)
})
