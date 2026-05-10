import test from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

function sourceFilesUnder(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return sourceFilesUnder(path)
    return entry.isFile() && /\.(ts|tsx)$/.test(entry.name) ? [path] : []
  })
}

function ensEditFlowText(): string {
  return sourceFilesUnder('src/identity/hub/flows/ens')
    .filter(file => /[\\/]EnsEdit|[\\/]ensEditCopy\.ts$/.test(file))
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
  const operators = readFileSync('src/identity/hub/flows/ens/OperatorWalletsScreen.tsx', 'utf8')
  const restoreFlow = readFileSync('src/identity/hub/flows/restore/RestoreFlow.tsx', 'utf8')
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
    ...sourceFilesUnder('src/identity/hub/effects'),
    ...sourceFilesUnder('src/identity/hub/reconciliation'),
    ...sourceFilesUnder('src/identity/hub/flows/ens'),
  ]
  const text = files.map(file => readFileSync(file, 'utf8')).join('\n')

  assert.doesNotMatch(text, new RegExp('[\\u00c2\\u00c3\\ufffd]'))
})

test('Identity Hub advanced ENS flow remains compact and focused', () => {
  const editFlow = ensEditFlowText()
  const operators = readFileSync('src/identity/hub/flows/ens/OperatorWalletsScreen.tsx', 'utf8')

  assert.match(editFlow, /title="ENS Name"/)
  assert.match(editFlow, /Current Setup/)
  assert.match(editFlow, /Token Custody Check/)
  assert.match(editFlow, /Prepare Token Transfer/)
  assert.match(editFlow, /Create one subdomain for this agent only/)
  assert.doesNotMatch(editFlow, /org\.ethagent\.operator/)
  assert.match(operators, /label: 'Operator Wallets'/)
  assert.match(operators, /label: 'Add Wallet'/)
  assert.match(operators, /Unlink \$\{shortAddress\(record\.address\)\}/)
  assert.match(operators, /Unlink All Operator Wallets/)
  assert.match(operators, /removeApprovedOperatorWallet\(records, address\)/)
  assert.doesNotMatch(operators, /Verify Operator Wallet|Sync ENS Operator Wallet|Metadata Operators/)
  assert.doesNotMatch(operators, /Paste Wallet Proof/)
  assert.doesNotMatch(editFlow, /FlowTimeline/)
  assert.doesNotMatch(editFlow, /SIMPLE_ENS_STEPS|ADVANCED_ENS_STEPS/)
})

test('Identity Hub token transfer copy keeps approvals out of the flow', () => {
  const menu = readFileSync('src/identity/hub/components/MenuScreen.tsx', 'utf8')
  const guide = readFileSync('src/identity/hub/flows/token-transfer/TokenTransferScreens.tsx', 'utf8')
  const effects = readFileSync('src/identity/hub/effects/token-transfer/progress.ts', 'utf8')

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
    'src/identity/hub/effects/ens/flows.ts',
    'src/identity/hub/effects/rebackup/runRebackup.ts',
    'src/identity/hub/flows/continuity/RecoveryConfirmScreen.tsx',
    'src/identity/hub/flows/token-transfer/TokenTransferScreens.tsx',
  ]
  const text = files.map(file => readFileSync(file, 'utf8')).join('\n')

  assert.doesNotMatch(text, new RegExp('on' + '-chain', 'i'))
  assert.doesNotMatch(text, /\bon chain\b/i)
  assert.match(text, /onchain/i)
})

test('vaulted public profile saves do not require Ethereum Mainnet ENS writes', () => {
  const publicProfile = readFileSync('src/identity/hub/effects/publicProfile/runPublicProfileSave.ts', 'utf8')
  const vaultFlow = publicProfile.slice(
    publicProfile.indexOf('async function runOperatorWalletVaultPublicProfileSave'),
    publicProfile.indexOf('type OperatorProfileArtifacts'),
  )

  assert.match(vaultFlow, /encodeRotateAgentURI/)
  assert.match(vaultFlow, /rotate-agent-uri-vault-operator/)
  assert.doesNotMatch(vaultFlow, /publishOperatorProfileEnsRecord/)
  assert.doesNotMatch(vaultFlow, /runUpdateEnsRecords/)
  assert.match(vaultFlow, /Profile updated\. ERC-8004 metadata published through the operator delegation vault\./)
})

test('public profile completion feedback starts capitalized', () => {
  const publicProfile = readFileSync('src/identity/hub/effects/publicProfile/runPublicProfileSave.ts', 'utf8')

  assert.doesNotMatch(publicProfile, /'profile pointer published/)
  assert.doesNotMatch(publicProfile, /'profile updated/)
  assert.match(publicProfile, /'Profile pointer published/)
  assert.match(publicProfile, /'Profile updated/)
})

test('README documents custody modes, ENS, and token transfer flow', () => {
  const readme = readFileSync('README.md', 'utf8')

  assert.match(readme, /## Custody Modes/)
  assert.match(readme, /\*\*Simple\*\*/)
  assert.match(readme, /\*\*Advanced\*\* splits an owner wallet/)
  assert.match(readme, /never receive token approval or transfer rights/)
  assert.match(readme, /Subdomains live under a parent name you control, never on root `\.eth` names directly/)
  assert.match(readme, /token ID \+ network/)
  assert.match(readme, /\*\*Load Agent\*\* accepts either an ENS name or a bare token ID/)
  assert.match(readme, /## Token Transfers/)
  assert.match(readme, /Prepare Token Transfer.*before any ERC-8004 token transfer/)
  assert.match(readme, /sender signs snapshot access, receiver signs restore access/)
  assert.match(readme, /The token transfer flow prepares decrypt access and agent URI pointers only/)
})
