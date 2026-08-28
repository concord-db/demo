import type { Track, Trajectory } from '../types'

export function cameraLetter(cameraId: string): string {
  if (cameraId.endsWith('highway2')) return 'A'
  if (cameraId.endsWith('highway3')) return 'B'
  return cameraId.replace('cam-i24v-', '')
}

export function qualifiedTrackId(cameraId: string, trackId: string): string {
  const trackNumber = trackId.replace(/^veh-/, '')
  return `Track ${trackNumber}${cameraLetter(cameraId)}`
}

export function trajectoryPairLabel(
  trajectory: Pick<Trajectory, 'vehicleId' | 'leftTrackId' | 'rightTrackId' | 'timeline'>,
): string {
  const leftCamera = trajectory.timeline[0]?.cameraId
  const rightCamera = trajectory.timeline[1]?.cameraId
  if (trajectory.leftTrackId && trajectory.rightTrackId && leftCamera && rightCamera) {
    return `${qualifiedTrackId(leftCamera, trajectory.leftTrackId)} / ${qualifiedTrackId(rightCamera, trajectory.rightTrackId)}`
  }
  return trajectory.vehicleId
}

export function trajectorySelectsTrack(
  trajectory: Trajectory | undefined,
  track: Pick<Track, 'cameraId' | 'trackId'>,
): boolean {
  if (!trajectory) return false
  const cameraIndex = trajectory.timeline.findIndex(
    (segment) => segment.cameraId === track.cameraId,
  )
  if (cameraIndex === 0) return trajectory.leftTrackId === track.trackId
  if (cameraIndex === 1) return trajectory.rightTrackId === track.trackId
  return false
}
