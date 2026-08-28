export type CameraId = 'cam-i24v-highway2' | 'cam-i24v-highway3'

export interface Camera {
  id: CameraId
  label: string
  video: string
  width: number
  height: number
  fps: number
}

export interface Detection {
  frame: number
  cameraId: CameraId
  bbox: [number, number, number, number]
  confidence: number
  vehicleClass: string
  color?: string
  subtype?: string
  trackId?: string
}

export interface Track {
  trackId: string
  cameraId: CameraId
  start: number
  end: number
  vehicleClass: string
  color: string
  subtype: string
  confidence: number
  path: Array<{ frame: number; x: number; y: number }>
  boxes: Array<{ frame: number; bbox: [number, number, number, number] }>
  hiddenUnlessSelected?: boolean
}

export interface TimelineSegment {
  cameraId: CameraId
  entered: number
  exited: number
}

export interface Trajectory {
  vehicleId: string
  attributes: { class: string; color: string; subtype: string }
  timeline: TimelineSegment[]
  matchScore?: number
  leftTrackId?: string
  rightTrackId?: string
  falsePositive?: boolean
}

export interface JoinCandidate {
  leftTrackId: string
  rightTrackId: string
  score: number
  accepted: boolean
}

export interface MetricSet {
  predictions: number
  truePositives: number
  falsePositives: number
  falseNegatives: number
  precision: number
  recall: number
  f1: number
  timelineIoU: number
  attributeExact: number
  wallTimeSeconds: number
  mllmCalls: number
  mllmTokens: number
}

export interface ReplayManifest {
  schemaVersion: number
  title: string
  duration: number
  source: {
    repository: string
    branch: string
    commit: string
    exportedAt: string
    dataset: string
  }
  cameras: Camera[]
  files: {
    detections: string
    tracks: string
    candidates: string
    semanticTrajectories: string
    optimizedTrajectories: string
    groundTruth: string
  }
  recordedRun: {
    model: string
    semantic: Partial<MetricSet>
    optimized: Partial<MetricSet>
  }
  publishedMetrics: {
    semantic: MetricSet
    optimized: MetricSet
  }
}

export interface ReplayData {
  manifest: ReplayManifest
  detections: Detection[]
  tracks: Track[]
  candidates: JoinCandidate[]
  semanticTrajectories: Trajectory[]
  optimizedTrajectories: Trajectory[]
  groundTruth: Trajectory[]
}
