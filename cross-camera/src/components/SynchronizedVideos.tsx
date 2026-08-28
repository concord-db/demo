import {
  ChevronLeft,
  ChevronRight,
  Pause,
  Play,
  RotateCcw,
} from 'lucide-react'
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { Camera, Detection, JoinCandidate, Track, Trajectory } from '../types'
import { formatSeconds, frameAt } from '../lib/replay'
import { overlayBoxesForStage, overlayLinksForStage, PIPELINE } from '../lib/pipelineOverlay'

interface Props {
  cameras: Camera[]
  duration: number
  stage: number
  detections: Detection[]
  tracks: Track[]
  candidates?: JoinCandidate[]
  trajectories?: Trajectory[]
  selectedTrajectory?: Trajectory
  onTimeChange?: (time: number) => void
}

const asset = (path: string) =>
  `${import.meta.env.BASE_URL}${path.replace(/^\/+/, '')}`

interface FrameLayout {
  left: number
  top: number
  width: number
  height: number
}

function centerInOverlay(
  bbox: [number, number, number, number],
  camera: Camera,
  frame: FrameLayout,
) {
  const [x1, y1, x2, y2] = bbox
  return {
    x: frame.left + ((x1 + x2) / 2 / camera.width) * frame.width,
    y: frame.top + ((y1 + y2) / 2 / camera.height) * frame.height,
  }
}

export function SynchronizedVideos({
  cameras,
  duration,
  stage,
  detections,
  tracks,
  candidates = [],
  trajectories = [],
  selectedTrajectory,
  onTimeChange,
}: Props) {
  const refs = useRef<Array<HTMLVideoElement | null>>([])
  const gridRef = useRef<HTMLDivElement | null>(null)
  const frameRefs = useRef<Array<HTMLDivElement | null>>([])
  const [playing, setPlaying] = useState(false)
  const [time, setTime] = useState(0)
  const [layout, setLayout] = useState<{ width: number; height: number; frames: FrameLayout[] }>()
  const fps = cameras[0]?.fps ?? 29.97
  const frame = frameAt(time, fps)

  const seek = (next: number) => {
    const clamped = Math.min(duration, Math.max(0, next))
    refs.current.forEach((video) => {
      if (video) video.currentTime = clamped
    })
    setTime(clamped)
    onTimeChange?.(clamped)
  }

  useEffect(() => {
    refs.current.forEach((video) => {
      if (!video) return
      if (playing) void video.play()
      else video.pause()
    })
  }, [playing])

  useEffect(() => {
    const interval = selectedTrajectory?.timeline[0]
    if (interval) seek(interval.entered)
    // A selected vehicle should seek once, not on every player tick.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedTrajectory?.vehicleId])

  const measure = () => {
    const grid = gridRef.current
    if (!grid) return
    const bounds = grid.getBoundingClientRect()
    setLayout({
      width: bounds.width,
      height: bounds.height,
      frames: frameRefs.current.flatMap((node) => {
        if (!node) return []
        const box = node.getBoundingClientRect()
        return [{
          left: box.left - bounds.left,
          top: box.top - bounds.top,
          width: box.width,
          height: box.height,
        }]
      }),
    })
  }

  useLayoutEffect(() => {
    measure()
    const grid = gridRef.current
    if (!grid || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(measure)
    observer.observe(grid)
    return () => observer.disconnect()
  }, [cameras, stage])

  const currentBoxes = useMemo(
    () => overlayBoxesForStage({
      stage,
      frame,
      detections,
      tracks,
      trajectories,
      selectedTrajectory,
    }),
    [detections, frame, selectedTrajectory, stage, tracks, trajectories],
  )

  const boxesByCamera = useMemo(() => {
    const map = new Map<string, typeof currentBoxes>()
    currentBoxes.forEach((box) => {
      const rows = map.get(box.cameraId) ?? []
      rows.push(box)
      map.set(box.cameraId, rows)
    })
    return map
  }, [currentBoxes])

  const links = useMemo(
    () => overlayLinksForStage({
      stage,
      cameras,
      boxes: currentBoxes,
      candidates,
      selectedTrajectory,
    }),
    [cameras, candidates, currentBoxes, selectedTrajectory, stage],
  )

  return (
    <div className="video-workspace">
      <div className="video-stage" ref={gridRef}>
      <div className="video-grid">
        {cameras.map((camera, index) => (
          <figure className="camera" key={camera.id}>
            <div
              className="video-frame"
              ref={(node) => {
                frameRefs.current[index] = node
              }}
            >
              <video
                ref={(node) => {
                  refs.current[index] = node
                }}
                src={asset(camera.video)}
                muted
                playsInline
                preload="metadata"
                onEnded={() => setPlaying(false)}
                onTimeUpdate={(event) => {
                  if (index !== 0) return
                  const next = event.currentTarget.currentTime
                  const peer = refs.current[1]
                  if (peer && Math.abs(peer.currentTime - next) > 0.08) {
                    peer.currentTime = next
                  }
                  setTime(next)
                  onTimeChange?.(next)
                }}
              />
              <svg
                className="overlay"
                viewBox={`0 0 ${camera.width} ${camera.height}`}
                aria-label={`${camera.label} annotations`}
              >
                {(boxesByCamera.get(camera.id) ?? []).map((item, boxIndex) => {
                  const [x1, y1, x2, y2] = item.bbox
                  return (
                    <g
                      className={item.highlighted ? 'box highlight' : 'box'}
                      key={`${camera.id}-${item.trackId ?? item.label}-${boxIndex}`}
                    >
                      <rect
                        x={x1}
                        y={y1}
                        width={x2 - x1}
                        height={y2 - y1}
                        stroke={item.color}
                        fill={item.fill}
                      />
                      {item.label ? (
                        <text x={x1} y={Math.max(18, y1 - 7)}>{item.label}</text>
                      ) : null}
                    </g>
                  )
                })}
              </svg>
              <span className="camera-badge">{camera.label}</span>
              <span className="frame-badge">frame {frame}</span>
            </div>
            <figcaption>{camera.id}</figcaption>
          </figure>
        ))}
      </div>
        {layout && links.length > 0 ? (
          <svg
            className="join-overlay"
            viewBox={`0 0 ${layout.width} ${layout.height}`}
            preserveAspectRatio="none"
            aria-hidden="true"
          >
            {links.map((link, index) => {
              const leftFrame = layout.frames[0]
              const rightFrame = layout.frames[1]
              const leftCamera = cameras[0]
              const rightCamera = cameras[1]
              if (!leftFrame || !rightFrame || !leftCamera || !rightCamera) return null
              const start = centerInOverlay(link.left.bbox, leftCamera, leftFrame)
              const end = centerInOverlay(link.right.bbox, rightCamera, rightFrame)
              return (
                <line
                  key={`${link.left.trackId}-${link.right.trackId}-${index}`}
                  x1={start.x}
                  y1={start.y}
                  x2={end.x}
                  y2={end.y}
                  stroke={link.color}
                  strokeWidth={link.emphasized ? 5 : 2.5}
                  strokeOpacity={link.emphasized ? 0.95 : 0.28 + 0.55 * Math.min(1, Math.max(0, (link.score - 0.4) / 0.6))}
                />
              )
            })}
          </svg>
        ) : null}
      </div>

      {stage >= PIPELINE.join ? (
        <p className="join-legend">
          {stage === PIPELINE.join
            ? 'Lines are appearance candidates · green is high score, red is low'
            : 'Lines are the one-to-one resolved matches'}
        </p>
      ) : null}

      <div className="player-controls" aria-label="Synchronized video controls">
        <button onClick={() => seek(0)} aria-label="Replay from start">
          <RotateCcw size={16} />
        </button>
        <button onClick={() => seek(time - 1 / fps)} aria-label="Previous frame">
          <ChevronLeft size={18} />
        </button>
        <button
          className="play-button"
          onClick={() => setPlaying((value) => !value)}
          aria-label={playing ? 'Pause both videos' : 'Play both videos'}
        >
          {playing ? <Pause size={18} /> : <Play size={18} />}
          {playing ? 'Pause' : 'Play'}
        </button>
        <button onClick={() => seek(time + 1 / fps)} aria-label="Next frame">
          <ChevronRight size={18} />
        </button>
        <span className="time">{formatSeconds(time)}</span>
        <input
          aria-label="Video timeline"
          type="range"
          min={0}
          max={duration}
          step={1 / fps}
          value={time}
          onChange={(event) => seek(Number(event.target.value))}
        />
        <span className="time">{formatSeconds(duration)}</span>
      </div>
    </div>
  )
}
