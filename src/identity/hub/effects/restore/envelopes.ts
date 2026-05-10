import { parseAgentStateBackupEnvelope } from '../../../crypto/backupEnvelope.js'
import {
  CONTINUITY_SNAPSHOT_ENVELOPE_VERSION,
  parseContinuitySnapshotEnvelope,
  type ContinuitySnapshotEnvelope,
} from '../../../continuity/envelope.js'

export type RestorableEnvelope = ReturnType<typeof parseAgentStateBackupEnvelope> | ContinuitySnapshotEnvelope

export function parseRestorableEnvelope(raw: string | Uint8Array): RestorableEnvelope {
  const text = typeof raw === 'string' ? raw : new TextDecoder().decode(raw)
  const parsed = JSON.parse(text) as { envelopeVersion?: unknown }
  if (parsed.envelopeVersion === CONTINUITY_SNAPSHOT_ENVELOPE_VERSION) {
    return parseContinuitySnapshotEnvelope(text)
  }
  return parseAgentStateBackupEnvelope(text)
}

export function isContinuitySnapshotEnvelope(envelope: RestorableEnvelope): envelope is ContinuitySnapshotEnvelope {
  return envelope.envelopeVersion === CONTINUITY_SNAPSHOT_ENVELOPE_VERSION
}
