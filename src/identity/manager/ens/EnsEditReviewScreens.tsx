import React from 'react'
import { Box, Text } from 'ink'
import { getAddress, type Address } from 'viem'
import { Surface } from '../../../ui/Surface.js'
import { Select, type SelectOption } from '../../../ui/Select.js'
import { theme } from '../../../ui/theme.js'
import type {
  AgentEnsRecords,
  AgentRecordDiff,
} from '../../ens/agentRecords.js'
import type { EnsValidation } from '../../ens/ensLookup.js'
import type {
  EnsSetupBlockedPlan,
  EnsSetupPlan,
} from '../../ens/ensAutomation.js'
import { createErc8004PublicClient, type Erc8004RegistryConfig } from '../../registry/erc8004.js'
import {
  displayCustodyMode,
  type CustodyMode,
} from '../custody/state.js'
import { ensValidationReasonText } from './state.js'
import { shortAddress } from '../shared/model/format.js'
import {
  abbreviateHexBlobs,
  manualReasonTitle,
  modeSwitchHeading,
} from './editCopy.js'
import {
  EnsSetupRow,
  footerHint,
  renderRecordValue,
} from './EnsEditShared.js'
import type { EnsIssueValidation } from './types.js'

type SimpleEnsIssueScreenProps = {
  fullName: string
  validation: EnsIssueValidation
  onCreate: () => void
  onCheckAgain: () => void
  onChange: () => void
  onBack: () => void
}

export const SimpleEnsIssueScreen: React.FC<SimpleEnsIssueScreenProps> = ({
  fullName,
  validation,
  onCreate,
  onCheckAgain,
  onChange,
  onBack,
}) => {
  type Action = 'create' | 'check-again' | 'change' | 'back'
  const reason = ensValidationReasonText(validation.reason)
  const showDetail = validation.detail && validation.detail !== reason
  return (
    <Surface
      title="ENS Name Not Found"
      footer={footerHint('↵ select · esc back')}
    >
      <Box flexDirection="column">
        <Text color={theme.dim}>The subdomain is not on Ethereum Mainnet yet. You can create it from here.</Text>
        <Text>
          <Text color={theme.dim}>{'Name'.padEnd(12)}</Text>
          <Text color={theme.text} bold>{fullName}</Text>
        </Text>
        <Text>
          <Text color={theme.dim}>{'Reason'.padEnd(12)}</Text>
          <Text color={theme.accentError}>{reason}</Text>
        </Text>
        {showDetail ? <Text color={theme.dim}>{validation.detail}</Text> : null}
      </Box>
      <Box marginTop={1}>
        <Select<Action>
          options={[
            { value: 'create', label: 'Create This ENS Name' },
            { value: 'change', label: 'Pick A Different Name' },
            { value: 'back', label: 'Back', role: 'utility' },
          ]}
          hintLayout="inline"
          onSubmit={choice => {
            if (choice === 'create') return onCreate()
            if (choice === 'check-again') return onCheckAgain()
            if (choice === 'change') return onChange()
            return onBack()
          }}
          onCancel={onBack}
        />
      </Box>
    </Surface>
  )
}

type EnsSetupReviewScreenProps = {
  setup: EnsSetupPlan
  currentEnsName: string
  currentMode: CustodyMode | undefined
  registry: Erc8004RegistryConfig
  onBegin: () => void
  onBack: () => void
}

export const EnsSetupReviewScreen: React.FC<EnsSetupReviewScreenProps> = ({
  setup,
  currentEnsName,
  currentMode,
  registry,
  onBegin,
  onBack,
}) => {
  type Action = 'begin' | 'back'
  const isSimple = setup.mode === 'simple'
  const signerLabel = isSimple ? 'Connected wallet' : 'Owner wallet'
  const createLabel = setup.registryAction === 'create-subdomain'
    ? 'Create Subdomain'
    : setup.registryAction === 'create-wrapped-subdomain'
      ? 'Create Wrapped Subdomain'
    : setup.registryAction === 'set-resolver'
      ? 'Set Resolver'
      : setup.registryAction === 'set-wrapped-resolver'
        ? 'Set Wrapped Resolver'
        : 'Subdomain Ready'
  const reusingExistingSubdomain = setup.registryAction === 'none'
  return (
    <Surface
      title={isSimple ? 'Create Simple ENS Name' : 'Create ENS Name'}
      footer={footerHint('↵ select · esc back')}
    >
      {reusingExistingSubdomain ? (
        <Box marginBottom={1}>
          <Text color={theme.accentPeriwinkle}>Subdomain detected from a prior attempt, reusing.</Text>
        </Box>
      ) : null}
      <Box flexDirection="column">
        <Text color={theme.dim}>{modeSwitchHeading(currentEnsName, currentMode, setup.fullName, setup.mode)}</Text>
        <EnsSetupRow label="ENS name" value={setup.fullName} />
        <EnsSetupRow label="Parent root" value={setup.rootName} />
        <EnsSetupRow label="Subdomain label" value={setup.label} />
        <EnsSetupRow label="ENS network" value="Ethereum Mainnet" />
        <EnsSetupRow label="Signer wallet" value={`${shortAddress(setup.ownerAddress)} (${signerLabel.toLowerCase()})`} />
        <EnsSetupRow label="Registry action" value={createLabel} />
      </Box>
      <Box marginTop={1}>
        <Select<Action>
          options={[
            { value: 'begin', label: 'Continue Setup' },
            { value: 'back', label: 'Back', role: 'utility' },
          ]}
          hintLayout="inline"
          onSubmit={choice => {
            if (choice === 'begin') return onBegin()
            return onBack()
          }}
          onCancel={onBack}
        />
      </Box>
    </Surface>
  )
}

type EnsSetupBlockedScreenProps = {
  fallback: EnsSetupBlockedPlan
  onCheckAgain: () => void
  onBack: () => void
}

export const EnsSetupBlockedScreen: React.FC<EnsSetupBlockedScreenProps> = ({
  fallback,
  onCheckAgain,
  onBack,
}) => {
  type Action = 'check' | 'back'
  const isSimple = fallback.mode === 'simple'
  return (
    <Surface
      title="ENS Setup Blocked"
      footer={footerHint('↵ select · esc back')}
    >
      <Box flexDirection="column">
        <Text color={theme.accentError}>{manualReasonTitle(fallback.reason)}</Text>
        <Text color={theme.dim}>{fallback.detail}</Text>
        <Box marginTop={1} flexDirection="column">
          <EnsSetupRow label="Agent ENS" value={fallback.fullName} />
          {isSimple
            ? <EnsSetupRow label="Wallet" value={fallback.ownerAddress ? shortAddress(fallback.ownerAddress) : shortAddress(fallback.operatorAddress)} />
            : (fallback.ownerAddress ? <EnsSetupRow label="Owner wallet" value={shortAddress(fallback.ownerAddress)} /> : null)}
          {fallback.nextRecords && Object.keys(fallback.nextRecords).length > 0
            ? <EnsSetupRow label="Attestation" value="ENSIP-25 agent-registration record" />
            : null}
          <EnsSetupRow label="Address" value={`Set the subdomain address record to the ${isSimple ? 'connected wallet' : 'owner wallet'}.`} />
          {!isSimple
            ? (
              <>
                <Box marginTop={1} flexDirection="column">
                  <Text color={theme.text}>To proceed: the owner wallet signs ENS records and must hold this token at setup time. Once setup is done you can deposit the token into the Vault while the ENS subdomain stays with the owner wallet.</Text>
                </Box>
                <Text color={theme.dim}>Operator wallets have no authority on this name; they only rotate the onchain ERC-8004 URI via the Vault.</Text>
              </>
              )
            : null}
        </Box>
      </Box>
      <Box marginTop={1}>
        <Select<Action>
          options={[
            { value: 'check', label: 'Check Again' },
            { value: 'back', label: 'Back', role: 'utility' },
          ]}
          hintLayout="inline"
          onSubmit={choice => {
            if (choice === 'check') return onCheckAgain()
            return onBack()
          }}
          onCancel={onBack}
        />
      </Box>
    </Surface>
  )
}

type UnlinkEnsReviewScreenProps = {
  fullName: string
  currentMode: CustodyMode | undefined
  registryNetworkLabel: string
  recordsDiff: AgentRecordDiff[]
  onUnlink: () => void
  onBack: () => void
}

export const UnlinkEnsReviewScreen: React.FC<UnlinkEnsReviewScreenProps> = ({
  fullName,
  currentMode,
  registryNetworkLabel,
  recordsDiff,
  onUnlink,
  onBack,
}) => {
  type Action = 'unlink' | 'back'
  const changedDiffs = recordsDiff.filter(diff => diff.current.trim())
  const recordsAlreadyEmpty = changedDiffs.length === 0
  return (
    <Surface
      title="Unlink ENS"
      footer={footerHint('↵ select · esc back')}
    >
      <Box flexDirection="column">
        <EnsSetupRow label="ENS name" value={fullName} />
        <EnsSetupRow label="Custody" value={displayCustodyMode(currentMode)} />
        {recordsAlreadyEmpty ? (
          <Box marginTop={1}>
            <Text color={theme.dim}>
              Removes the token URI link only.
            </Text>
          </Box>
        ) : (
          <Box marginTop={1} flexDirection="column">
            <Text color={theme.textSubtle}>Will be cleared:</Text>
            {changedDiffs.map(diff => (
              <Text key={diff.key}>
                <Text color={theme.dim}>{`  ${abbreviateHexBlobs(diff.key)}  `}</Text>
                <Text color={theme.accentPeriwinkle}>{abbreviateHexBlobs(diff.current)}</Text>
              </Text>
            ))}
          </Box>
        )}
      </Box>
      <Box marginTop={1}>
        <Select<Action>
          options={[
            { value: 'unlink', label: 'Unlink ENS' },
            { value: 'back', label: 'Back', role: 'utility' },
          ]}
          hintLayout="inline"
          onSubmit={choice => {
            if (choice === 'unlink') return onUnlink()
            return onBack()
          }}
          onCancel={onBack}
        />
      </Box>
    </Surface>
  )
}

type ReviewScreenProps = {
  fullName: string
  ownerAddress: Address
  validation: EnsValidation
  recordsDiff: AgentRecordDiff[]
  nextRecords: AgentEnsRecords
  currentEnsName: string
  currentMode: CustodyMode | undefined
  registryNetworkLabel: string
  mode: 'simple' | 'advanced'
  onContinue: () => void
  onCheckAgain: () => void
  onChange: () => void
  onCreate?: () => void
  onBack: () => void
}

export const ReviewScreen: React.FC<ReviewScreenProps> = ({
  fullName,
  ownerAddress,
  validation,
  recordsDiff,
  nextRecords,
  currentEnsName,
  currentMode,
  registryNetworkLabel,
  mode,
  onContinue,
  onCheckAgain,
  onChange,
  onCreate,
  onBack,
}) => {
  void ownerAddress
  void nextRecords
  type ReviewAction = 'continue' | 'create' | 'check-again' | 'change' | 'back'
  const changedDiffs = recordsDiff.filter(d => d.changed)
  const hasRecordChanges = changedDiffs.length > 0
  const reviewSubtitle = 'Review ENS records before linking.'

  if (!validation.ok) {
    const reason = ensValidationReasonText(validation.reason)
    const showDetail = validation.detail && validation.detail !== reason
    return (
      <Surface
        title="ENS Issue"
        subtitle={`${fullName} could not be verified on Ethereum mainnet.`}
        footer={footerHint('↵ select · esc back')}
      >
        <Box flexDirection="column">
          <Text>
            <Text color={theme.dim}>{'Name'.padEnd(12)}</Text>
            <Text color={theme.text} bold>{fullName}</Text>
          </Text>
          <Text>
            <Text color={theme.dim}>{'Reason'.padEnd(12)}</Text>
            <Text color={theme.accentError}>{reason}</Text>
          </Text>
          {showDetail
            ? <Text color={theme.dim}>{validation.detail}</Text>
            : null}
        </Box>
        <Box marginTop={1}>
          <Select<ReviewAction>
            options={[
              ...(onCreate
                ? [
                    { value: 'create' as ReviewAction, label: 'Create This ENS Name' },
                  ]
                : []),
              { value: 'check-again', label: 'Check Again' },
              { value: 'change', label: 'Pick A Different Name' },
              { value: 'back', label: 'Back', role: 'utility' },
            ]}
            hintLayout="inline"
            onSubmit={choice => {
              if (choice === 'create' && onCreate) return onCreate()
              if (choice === 'check-again') return onCheckAgain()
              if (choice === 'change') return onChange()
              return onBack()
            }}
            onCancel={onBack}
          />
        </Box>
      </Surface>
    )
  }

  const options: Array<SelectOption<ReviewAction>> = [
    { value: 'continue', label: 'Continue Setup' },
    { value: 'change', label: 'Pick A Different Name' },
    { value: 'back', label: 'Back', role: 'utility' },
  ]

  return (
    <Surface
      title={`Update ENS records for ${fullName}?`}
      subtitle={reviewSubtitle}
      footer={footerHint('↵ select · esc back')}
    >
      <Box flexDirection="column">
        {currentEnsName || currentMode
          ? (
            <Box marginBottom={1} flexDirection="column">
              <Text color={theme.dim}>Current: <Text color={currentEnsName ? theme.text : theme.dim}>{currentEnsName || 'None'}</Text></Text>
              <Text color={theme.dim}>Next: <Text color={theme.text}>{fullName}</Text></Text>
            </Box>
            )
          : null}
        {recordsDiff.map(diff => (
          <Text key={diff.key}>
            <Text color={theme.dim}>{`- ${abbreviateHexBlobs(diff.key)}: `}</Text>
            {diff.changed
              ? (
                <>
                  {renderRecordValue(diff.current)}
                  <Text color={theme.dim}>{' → '}</Text>
                  {renderRecordValue(diff.next)}
                </>
              )
              : renderRecordValue(diff.next)}
          </Text>
        ))}
        {!hasRecordChanges
          ? <Box marginTop={1}><Text color={theme.dim}>All ENS records already match. Link this ENS name to the token URI.</Text></Box>
          : null}
      </Box>
      <Box marginTop={1}>
        <Select<ReviewAction>
          options={options}
          hintLayout="inline"
          onSubmit={choice => {
            if (choice === 'continue') return onContinue()
            if (choice === 'change') return onChange()
            return onBack()
          }}
          onCancel={onBack}
        />
      </Box>
    </Surface>
  )
}
