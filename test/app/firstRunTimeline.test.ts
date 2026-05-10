import test from 'node:test'
import assert from 'node:assert/strict'
import {
  FIRST_RUN_STAGES,
  firstRunStageNumber,
  type FirstRunStepKind,
} from '../../src/app/FirstRunTimeline.js'

test('FIRST_RUN_STAGES is the three-stage outer flow', () => {
  assert.deepEqual(FIRST_RUN_STAGES, ['Inspect', 'Identity', 'Model'])
})

test('firstRunStageNumber places detection steps in stage 1 (Inspect)', () => {
  assert.equal(firstRunStageNumber('detecting'), 1)
  assert.equal(firstRunStageNumber('detect-error'), 1)
})

test('firstRunStageNumber places identity steps in stage 2 (Identity)', () => {
  assert.equal(firstRunStageNumber('identity-start'), 2)
  assert.equal(firstRunStageNumber('identity-start-saving'), 2)
})

test('firstRunStageNumber places model selection and credential steps in stage 3 (Model)', () => {
  const modelKinds: FirstRunStepKind[] = [
    'choose-path',
    'cloud-provider',
    'cloud-key',
    'cloud-key-saving',
    'cloud-model',
    'hf-setup',
  ]
  for (const kind of modelKinds) {
    assert.equal(firstRunStageNumber(kind), 3, `${kind} should map to stage 3`)
  }
})

test('firstRunStageNumber places persistence steps past the last stage (all complete)', () => {
  assert.equal(firstRunStageNumber('saving'), 4)
  assert.equal(firstRunStageNumber('save-error'), 4)
  assert.equal(firstRunStageNumber('done'), 4)
})
