import { describe, expect, it } from 'vitest'
import { cameraLetter, qualifiedTrackId, trajectoryPairLabel, trajectorySelectsTrack } from './trackIdentity'
import type { Trajectory } from '../types'

const selected: Trajectory = {
  vehicleId: 'joined-vehicle',
  attributes: { class: 'sedan', color: 'blue', subtype: 'sedan' },
  timeline: [
    { cameraId: 'cam-i24v-highway2', entered: 0, exited: 1 },
    { cameraId: 'cam-i24v-highway3', entered: 0, exited: 1 },
  ],
  leftTrackId: 'veh-20',
  rightTrackId: 'veh-28',
}

describe('camera-qualified track selection', () => {
  it('does not highlight an equal numeric track ID in another camera', () => {
    expect(
      trajectorySelectsTrack(selected, {
        cameraId: 'cam-i24v-highway2',
        trackId: 'veh-20',
      }),
    ).toBe(true)
    expect(
      trajectorySelectsTrack(selected, {
        cameraId: 'cam-i24v-highway3',
        trackId: 'veh-20',
      }),
    ).toBe(false)
  })

  it('renders camera-qualified labels', () => {
    expect(qualifiedTrackId('cam-i24v-highway2', 'veh-20')).toBe('Track 20A')
    expect(qualifiedTrackId('cam-i24v-highway3', 'veh-20')).toBe('Track 20B')
  })

  it('renders a friendly joined pair without naming the cameras', () => {
    expect(cameraLetter('cam-i24v-highway2')).toBe('A')
    expect(cameraLetter('cam-i24v-highway3')).toBe('B')
    expect(trajectoryPairLabel(selected)).toBe('Track 20A / Track 28B')
    expect(trajectoryPairLabel({ ...selected, leftTrackId: undefined, rightTrackId: undefined })).toBe(
      'joined-vehicle',
    )
  })
})
