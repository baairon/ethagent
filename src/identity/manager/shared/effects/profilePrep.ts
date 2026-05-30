import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { getAddress, type Address } from 'viem'
import type { EthagentIdentity } from '../../../../storage/config.js'
import type { ProfileUpdates } from '../../reducer.js'
import type { Erc8004RegistryConfig } from '../../../registry/erc8004.js'
import { addFileToIpfs, DEFAULT_IPFS_API_URL, type IpfsAddResult } from '../../../storage/ipfs.js'
import { agentIconContentType, isAgentIconUrl, validateAgentIconReference } from '../../../profile/agentIcon.js'
import {
  applyEnsValidationState,
  applyOperatorProfileState,
  validateEnsForProfileUpdate,
} from '../../profile/state.js'

type PreparedProfileState = {
  state: Record<string, unknown>
  nextName: string | undefined
  nextDescription: string
  nextEnsName: string | undefined
  uploadedImageUri: string | undefined
}

export function deriveAgentName(identity: EthagentIdentity): string {
  const state = (identity.state ?? {}) as Record<string, unknown>
  const name = typeof state.name === 'string' ? state.name.trim() : ''
  if (name) return name
  return identity.agentId ? `agent #${identity.agentId}` : 'unnamed agent'
}

export async function resolveAgentIconReference(iconPath: string, pinataJwt: string | undefined): Promise<string> {
  const validationError = validateAgentIconReference(iconPath)
  if (validationError) throw new Error(validationError)
  const trimmed = iconPath.trim()
  if (isAgentIconUrl(trimmed)) return trimmed
  const file = resolveAgentIconPath(trimmed)
  const data = await fs.readFile(file)
  const contentType = agentIconContentType(file)
  const pin = await addFileToIpfs(DEFAULT_IPFS_API_URL, data, path.basename(file), contentType, fetch, { pinataJwt })
  assertVerifiedPin(pin)
  return `ipfs://${pin.cid}`
}

export function resolveAgentIconPath(input: string): string {
  const trimmed = input.trim()
  if (!trimmed) throw new Error('Agent Icon path is empty')
  return path.resolve(trimmed.replace(/^~(?=$|[\\/])/, os.homedir()))
}

export async function prepareProfileStateForSave(args: {
  identity: EthagentIdentity
  registry: Erc8004RegistryConfig
  profileUpdates: ProfileUpdates | undefined
  pinataJwt: string | undefined
  ownerAddress: Address
  walletAccount: Address
  includeLastBackedUpAt: boolean
}): Promise<PreparedProfileState> {
  const baseState = (args.identity.state ?? {}) as Record<string, unknown>
  const profile = args.profileUpdates ?? {}
  const nextName = typeof profile.name === 'string' && profile.name.trim()
    ? profile.name.trim()
    : typeof baseState.name === 'string'
      ? baseState.name
      : undefined
  const nextDescription = profile.description !== undefined
    ? profile.description.trim()
    : typeof baseState.description === 'string'
      ? baseState.description
      : ''
  const nextEnsName = typeof profile.ensName === 'string'
    ? profile.ensName.trim() || undefined
    : typeof baseState.ensName === 'string' && baseState.ensName.trim()
      ? baseState.ensName.trim()
      : undefined
  const uploadedImageUri = profile.imagePath === 'delete'
    ? ''
    : profile.imagePath
      ? await resolveAgentIconReference(profile.imagePath, args.pinataJwt)
      : typeof baseState.imageUrl === 'string' && baseState.imageUrl.trim()
        ? baseState.imageUrl.trim()
        : undefined

  const state: Record<string, unknown> = {
    ...baseState,
    ownerAddress: getAddress(args.ownerAddress),
    ...(nextName !== undefined ? { name: nextName } : {}),
    description: nextDescription,
    ...(args.includeLastBackedUpAt ? { lastBackedUpAt: new Date().toISOString() } : {}),
  }
  if (uploadedImageUri === '') {
    delete state.imageUrl
  } else if (uploadedImageUri) {
    state.imageUrl = uploadedImageUri
  }

  applyOperatorProfileState(state, profile, baseState)
  if (typeof profile.ensName === 'string') {
    if (nextEnsName) {
      state.ensName = nextEnsName
      const validation = await validateEnsForProfileUpdate(
        nextEnsName,
        args.walletAccount,
        profile,
        baseState,
        args.identity,
        args.registry,
      )
      applyEnsValidationState(state, validation, profile, baseState)
    } else {
      clearEnsProfileState(state)
    }
  }

  return {
    state,
    nextName,
    nextDescription,
    nextEnsName,
    uploadedImageUri,
  }
}

export function clearEnsProfileState(state: Record<string, unknown>): void {
  delete state.ensName
  delete state.ensValidation
}

export function assertVerifiedPin(pin: IpfsAddResult, expectedCid?: string): void {
  if (expectedCid && pin.cid !== expectedCid) throw new Error('IPFS pin verification did not match the published CID')
  if (!pin.pinVerified) throw new Error(`IPFS pin was not verified for ${pin.cid}`)
}

export function readEnsOkFromState(state: Record<string, unknown> | undefined): boolean | undefined {
  const raw = state?.ensValidation
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined
  const ok = (raw as Record<string, unknown>).ok
  return typeof ok === 'boolean' ? ok : undefined
}
