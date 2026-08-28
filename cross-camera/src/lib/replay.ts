import type { ReplayData, ReplayManifest } from '../types'

const fromBase = (path: string) =>
  `${import.meta.env.BASE_URL}${path.replace(/^\/+/, '')}`

async function getJson<T>(path: string): Promise<T> {
  const response = await fetch(fromBase(path))
  if (!response.ok) {
    throw new Error(`Could not load ${path} (${response.status})`)
  }
  return response.json() as Promise<T>
}

export function validateManifest(manifest: ReplayManifest): string[] {
  const errors: string[] = []
  if (manifest.schemaVersion !== 1) errors.push('Unsupported replay schema')
  if (manifest.cameras.length !== 2) errors.push('Exactly two cameras are required')
  if (manifest.duration <= 0) errors.push('Duration must be positive')
  const ids = new Set(manifest.cameras.map((camera) => camera.id))
  if (ids.size !== manifest.cameras.length) errors.push('Camera IDs must be unique')
  if (manifest.publishedMetrics.semantic.mllmCalls !== 1) {
    errors.push('Published semantic MLLM call count must be 1')
  }
  if (manifest.publishedMetrics.optimized.mllmCalls !== 0) {
    errors.push('Published optimized MLLM call count must be 0')
  }
  return errors
}

export async function loadReplayData(manifestPath: string): Promise<ReplayData> {
  const manifest = await getJson<ReplayManifest>(manifestPath)
  const errors = validateManifest(manifest)
  if (errors.length) throw new Error(errors.join('; '))
  const base = manifestPath.slice(0, manifestPath.lastIndexOf('/') + 1)
  const [
    detections,
    tracks,
    candidates,
    semanticTrajectories,
    optimizedTrajectories,
    groundTruth,
  ] = await Promise.all([
    getJson<ReplayData['detections']>(base + manifest.files.detections),
    getJson<ReplayData['tracks']>(base + manifest.files.tracks),
    getJson<ReplayData['candidates']>(base + manifest.files.candidates),
    getJson<ReplayData['semanticTrajectories']>(
      base + manifest.files.semanticTrajectories,
    ),
    getJson<ReplayData['optimizedTrajectories']>(
      base + manifest.files.optimizedTrajectories,
    ),
    getJson<ReplayData['groundTruth']>(base + manifest.files.groundTruth),
  ])
  return {
    manifest,
    detections,
    tracks,
    candidates,
    semanticTrajectories,
    optimizedTrajectories,
    groundTruth,
  }
}

export function frameAt(time: number, fps: number): number {
  return Math.max(0, Math.round(time * fps))
}

export function formatSeconds(value: number): string {
  return `${value.toFixed(2)}s`
}
