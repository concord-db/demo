import type { Camera, Detection, JoinCandidate, Track, Trajectory } from '../types'
import { nearestBox, paletteColor, scoreColor } from './overlayStyle'
import { trajectorySelectsTrack } from './trackIdentity'

export const PIPELINE = {
  input: 0,
  detect: 1,
  track: 2,
  join: 3,
  resolve: 4,
  associate: 5,
} as const

export interface OverlayBox {
  cameraId: string
  trackId?: string
  bbox: [number, number, number, number]
  color: string
  fill: string
  label?: string
  highlighted: boolean
}

export interface OverlayLink {
  left: OverlayBox
  right: OverlayBox
  score: number
  color: string
  emphasized: boolean
}

export function colorKey(
  track: Track,
  stage: number,
  trajectories: Trajectory[],
): string {
  if (stage >= PIPELINE.resolve) {
    const pair = trajectories.find((trajectory) => trajectorySelectsTrack(trajectory, track))
    if (pair) return `pair:${pair.vehicleId}`
  }
  return `track:${track.cameraId}:${track.trackId}`
}

export function colorTable(
  tracks: Track[],
  stage: number,
  trajectories: Trajectory[],
): Map<string, { stroke: string; fill: string }> {
  const keys = [...new Set(tracks.map((track) => colorKey(track, stage, trajectories)))].sort()
  return new Map(keys.map((key, index) => [key, paletteColor(index, keys.length)]))
}

export function overlayBoxesForStage(args: {
  stage: number
  frame: number
  detections: Detection[]
  tracks: Track[]
  trajectories: Trajectory[]
  selectedTrajectory?: Trajectory
}): OverlayBox[] {
  const { stage, frame, detections, tracks, trajectories, selectedTrajectory } = args
  if (stage === PIPELINE.detect) {
    return detections
      .filter((item) => item.frame === frame)
      .map((item) => ({
        cameraId: item.cameraId,
        bbox: item.bbox,
        color: 'hsl(16, 82%, 58%)',
        fill: 'hsla(16, 82%, 58%, 0.16)',
        label: item.vehicleClass,
        highlighted: false,
      }))
  }
  if (stage < PIPELINE.track) return []
  const colors = colorTable(tracks, stage, trajectories)
  return tracks.flatMap((track) => {
    if (track.hiddenUnlessSelected && !trajectorySelectsTrack(selectedTrajectory, track)) {
      return []
    }
    const box = nearestBox(track.boxes, frame)
    if (!box) return []
    const paint = colors.get(colorKey(track, stage, trajectories))
    const highlighted = trajectorySelectsTrack(selectedTrajectory, track)
    return [{
      cameraId: track.cameraId,
      trackId: track.trackId,
      bbox: box.bbox,
      color: paint?.stroke ?? 'hsl(16, 82%, 58%)',
      fill: paint?.fill ?? 'hsla(16, 82%, 58%, 0.16)',
      highlighted,
    }]
  })
}

export function overlayLinksForStage(args: {
  stage: number
  cameras: Camera[]
  boxes: OverlayBox[]
  candidates: JoinCandidate[]
  selectedTrajectory?: Trajectory
}): OverlayLink[] {
  const { stage, cameras, boxes, candidates, selectedTrajectory } = args
  if (stage < PIPELINE.join) return []
  const leftCamera = cameras[0]?.id
  const rightCamera = cameras[1]?.id
  if (!leftCamera || !rightCamera) return []
  const boxByTrack = new Map(
    boxes
      .filter((box) => box.trackId)
      .map((box) => [`${box.cameraId}:${box.trackId}`, box] as const),
  )
  const rows = stage >= PIPELINE.resolve ? candidates.filter((item) => item.accepted) : candidates
  const links: OverlayLink[] = []
  for (const candidate of rows) {
    const left = boxByTrack.get(`${leftCamera}:${candidate.leftTrackId}`)
    const right = boxByTrack.get(`${rightCamera}:${candidate.rightTrackId}`)
    if (!left || !right) continue
    links.push({
      left,
      right,
      score: candidate.score,
      color: scoreColor(candidate.score),
      emphasized: Boolean(
        selectedTrajectory
        && selectedTrajectory.leftTrackId === candidate.leftTrackId
        && selectedTrajectory.rightTrackId === candidate.rightTrackId,
      ),
    })
  }
  return links
}
