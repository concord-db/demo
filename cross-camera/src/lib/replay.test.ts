import { describe, expect, it } from 'vitest'
import { frameAt, validateManifest } from './replay'
import type { ReplayManifest } from '../types'

const manifest = {
  schemaVersion: 1,
  duration: 5,
  cameras: [
    { id: 'cam-i24v-highway2', fps: 29.97 },
    { id: 'cam-i24v-highway3', fps: 29.97 },
  ],
  publishedMetrics: {
    semantic: { mllmCalls: 1 },
    optimized: { mllmCalls: 0 },
  },
} as ReplayManifest

describe('replay helpers', () => {
  it('maps source time to the nearest frame', () => {
    expect(frameAt(1, 29.97)).toBe(30)
    expect(frameAt(-1, 29.97)).toBe(0)
  })

  it('accepts the frozen two-camera manifest contract', () => {
    expect(validateManifest(manifest)).toEqual([])
  })

  it('rejects inference-call provenance that contradicts the paper', () => {
    const invalid = structuredClone(manifest)
    invalid.publishedMetrics.optimized.mllmCalls = 1
    expect(validateManifest(invalid)).toContain(
      'Published optimized MLLM call count must be 0',
    )
  })
})
