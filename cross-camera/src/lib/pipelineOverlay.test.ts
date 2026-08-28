import { describe, expect, it } from 'vitest'
import { overlayBoxesForStage, overlayLinksForStage, PIPELINE } from './pipelineOverlay'
import type { Camera, Detection, JoinCandidate, Track, Trajectory } from '../types'

const cameras: Camera[] = [
  { id: 'cam-i24v-highway2', label: 'Camera 02', video: '', width: 1920, height: 1080, fps: 30 },
  { id: 'cam-i24v-highway3', label: 'Camera 03', video: '', width: 1920, height: 1080, fps: 30 },
]

const detections: Detection[] = [
  { frame: 26, cameraId: 'cam-i24v-highway2', bbox: [0, 0, 10, 10], confidence: 0.5, vehicleClass: 'sedan' },
  { frame: 27, cameraId: 'cam-i24v-highway2', bbox: [1, 1, 11, 11], confidence: 0.5, vehicleClass: 'sedan' },
  { frame: 28, cameraId: 'cam-i24v-highway2', bbox: [2, 2, 12, 12], confidence: 0.5, vehicleClass: 'sedan' },
]

const tracks: Track[] = [
  {
    trackId: 'veh-20',
    cameraId: 'cam-i24v-highway2',
    start: 0,
    end: 1,
    vehicleClass: 'sedan',
    color: 'silver',
    subtype: 'sedan',
    confidence: 0.9,
    path: [],
    boxes: [
      { frame: 26, bbox: [0, 0, 10, 10] },
      { frame: 27, bbox: [10, 10, 20, 20] },
    ],
  },
  {
    trackId: 'veh-28',
    cameraId: 'cam-i24v-highway3',
    start: 0,
    end: 1,
    vehicleClass: 'sedan',
    color: 'silver',
    subtype: 'sedan',
    confidence: 0.9,
    path: [],
    boxes: [{ frame: 27, bbox: [40, 40, 50, 50] }],
  },
  {
    trackId: 'veh-7',
    cameraId: 'cam-i24v-highway3',
    start: 0,
    end: 1,
    vehicleClass: 'suv',
    color: 'blue',
    subtype: 'suv',
    confidence: 0.8,
    path: [],
    boxes: [{ frame: 27, bbox: [80, 80, 90, 90] }],
  },
]

const trajectories: Trajectory[] = [{
  vehicleId: 'joined-vehicle',
  attributes: { class: 'sedan', color: 'silver', subtype: 'sedan' },
  timeline: [
    { cameraId: 'cam-i24v-highway2', entered: 0, exited: 1 },
    { cameraId: 'cam-i24v-highway3', entered: 0, exited: 1 },
  ],
  leftTrackId: 'veh-20',
  rightTrackId: 'veh-28',
}]

const candidates: JoinCandidate[] = [
  { leftTrackId: 'veh-20', rightTrackId: 'veh-28', score: 0.91, accepted: true },
  { leftTrackId: 'veh-20', rightTrackId: 'veh-7', score: 0.5, accepted: false },
]

describe('pipeline overlay', () => {
  it('shows one detection box per object at Detect, not adjacent-frame stacks', () => {
    const boxes = overlayBoxesForStage({
      stage: PIPELINE.detect,
      frame: 27,
      detections,
      tracks,
      trajectories,
    })
    expect(boxes).toHaveLength(1)
    expect(boxes[0]?.bbox).toEqual([1, 1, 11, 11])
  })

  it('replaces detections with a single track box at Track', () => {
    const boxes = overlayBoxesForStage({
      stage: PIPELINE.track,
      frame: 27,
      detections,
      tracks,
      trajectories,
    })
    expect(boxes).toHaveLength(3)
    expect(boxes.every((box) => box.trackId)).toBe(true)
  })

  it('draws every visible candidate at Join and only accepted pairs at Resolve', () => {
    const boxes = overlayBoxesForStage({
      stage: PIPELINE.join,
      frame: 27,
      detections,
      tracks,
      trajectories,
    })
    const joinLinks = overlayLinksForStage({
      stage: PIPELINE.join,
      cameras,
      boxes,
      candidates,
    })
    const resolveLinks = overlayLinksForStage({
      stage: PIPELINE.resolve,
      cameras,
      boxes,
      candidates,
    })
    expect(joinLinks).toHaveLength(2)
    expect(resolveLinks).toHaveLength(1)
    expect(overlayLinksForStage({
      stage: PIPELINE.associate,
      cameras,
      boxes,
      candidates,
    })).toHaveLength(1)
  })

  it('uses one shared color for a matched pair at Associate', () => {
    const boxes = overlayBoxesForStage({
      stage: PIPELINE.associate,
      frame: 27,
      detections,
      tracks,
      trajectories,
    })
    expect(boxes[0]?.color).toBe(boxes[1]?.color)
    expect(boxes[2]?.color).not.toBe(boxes[0]?.color)
    const trackBoxes = overlayBoxesForStage({
      stage: PIPELINE.track,
      frame: 27,
      detections,
      tracks,
      trajectories,
    })
    expect(trackBoxes[0]?.color).not.toBe(trackBoxes[1]?.color)
    expect(new Set(trackBoxes.map((box) => box.color)).size).toBe(3)
    const resolveBoxes = overlayBoxesForStage({
      stage: PIPELINE.resolve,
      frame: 27,
      detections,
      tracks,
      trajectories,
    })
    expect(resolveBoxes[0]?.color).toBe(resolveBoxes[1]?.color)
  })
})
