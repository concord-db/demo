import { ArrowDown, ExternalLink, GitBranch, LoaderCircle, Radio, Zap } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import './App.css'
import { MetricsComparison } from './components/MetricsComparison'
import { PipelineExplorer, type Stage } from './components/PipelineExplorer'
import { SynchronizedVideos } from './components/SynchronizedVideos'
import { examples } from './examples/registry'
import { loadReplayData } from './lib/replay'
import { cameraLetter, trajectoryPairLabel } from './lib/trackIdentity'
import type { ReplayData, Trajectory } from './types'

function App() {
  const example = examples[0]
  const [data, setData] = useState<ReplayData>()
  const [error, setError] = useState('')
  const [mode, setMode] = useState<'optimized' | 'semantic'>('optimized')
  const [stage, setStage] = useState(0)
  const [running, setRunning] = useState(false)
  const [selected, setSelected] = useState<Trajectory>()
  const timers = useRef<number[]>([])

  useEffect(() => {
    const activeTimers = timers.current
    loadReplayData(example.manifest).then(setData).catch((reason: Error) => setError(reason.message))
    return () => activeTimers.forEach(window.clearTimeout)
  }, [example.manifest])

  const changeMode = (nextMode: 'optimized' | 'semantic') => {
    setMode(nextMode)
    setStage(0)
    setSelected(undefined)
    timers.current.forEach(window.clearTimeout)
    setRunning(false)
  }

  const stages = useMemo<Stage[]>(() => {
    if (!data) return []
    if (mode === 'semantic') {
      return [
        { name: 'Input', short: '2 synchronized clips', detail: 'Group both five-second camera feeds as one semantic input.', count: 2 },
        { name: 'Sem_Associate', short: 'Gemini Reduce', detail: 'A single MLLM operation discovers, tracks, and associates vehicles monolithically.', count: 1 },
        { name: 'Unnest', short: 'trajectory records', detail: 'Expand the returned collection into one row per cross-camera vehicle.', count: data.semanticTrajectories.length },
      ]
    }
    return [
      { name: 'Input', short: '2 synchronized clips', detail: 'Read two source-aligned camera records that share the same five-second clock.', count: 2 },
      { name: 'Detect', short: 'YOLOE + NMS', detail: 'Materialized frame-level vehicle boxes make entity coverage inspectable.', count: data.detections.length },
      { name: 'Track', short: 'motion-aware linking', detail: 'Link detections over time into stable, camera-local vehicle tracks.', count: data.tracks.length },
      { name: 'Join', short: 'appearance candidates', detail: 'Score motion-compatible tracks from different cameras by appearance similarity.', count: data.candidates.length },
      { name: 'Resolve', short: 'one-to-one', detail: 'Greedily retain high-scoring pairs so each camera-local track is matched once.', count: data.candidates.filter((item) => item.accepted).length },
      { name: 'Associate', short: 'trajectory records', detail: 'Project resolved pairs to the common vehicle trajectory output schema.', count: data.optimizedTrajectories.length },
    ]
  }, [data, mode])

  const runReplay = () => {
    timers.current.forEach(window.clearTimeout)
    setStage(0)
    setRunning(true)
    stages.slice(1).forEach((_, index) => {
      timers.current.push(window.setTimeout(() => setStage(index + 1), (index + 1) * 620))
    })
    timers.current.push(window.setTimeout(() => setRunning(false), stages.length * 620))
  }

  if (error) {
    return <main className="load-state"><h1>Replay unavailable</h1><p>{error}</p></main>
  }
  if (!data) {
    return <main className="load-state"><LoaderCircle className="spin" /><p>Loading recorded operators…</p></main>
  }

  const trajectories = mode === 'optimized' ? data.optimizedTrajectories : data.semanticTrajectories
  const visibleTrajectories = stage === stages.length - 1 ? trajectories : []

  return (
    <div className="site">
      <header className="topbar">
        <a className="brand" href="#"><span className="brand-mark">C</span><span>Concord <small>research demo</small></span></a>
        <nav>
          <a href="../">All demos</a>
          <a href="#demo">Demo</a>
          <a href="#results">Results</a>
          <a href="https://github.com/chanwutk/mmds" target="_blank">MMDS <GitBranch size={15} /></a>
        </nav>
      </header>

      <main>
        <section className="hero">
          <div className="hero-copy">
            <span className="eyebrow"><Radio size={14} /> CIDR 2027 · Interactive artifact</span>
            <h1>One highway.<br />Two cameras.<br /><em>A better query.</em></h1>
            <p>
              See how Concord rewrites a monolithic semantic video join into
              explicit Detect–Track–Join operators—improving F1 from <strong>.364</strong> to <strong>.813</strong>.
            </p>
            <div className="hero-actions">
              <a className="primary-action" href="#demo">Explore the replay <ArrowDown size={17} /></a>
              <a href="https://github.com/chanwutk/mmds" target="_blank">View source <ExternalLink size={15} /></a>
            </div>
          </div>
          <div className="hero-diagram" aria-label="Query rewrite summary">
            <div className="query-card semantic-card"><span>Semantic query</span><code>Reduce → Unnest</code><small>1 opaque MLLM call</small></div>
            <div className="rewrite-mark"><Zap size={19} /><span>O3 rewrite</span></div>
            <div className="query-card optimized-card"><span>Structured query</span><code>Detect → Track → Join</code><small>0 MLLM calls · inspectable</small></div>
          </div>
        </section>

        <section className="demo-section" id="demo">
          <div className="section-heading">
            <div><span className="eyebrow">{example.eyebrow}</span><h2>{example.title}</h2></div>
            <p>Everything below is a deterministic replay of pre-recorded outputs. No inference runs in your browser.</p>
          </div>

          <div className="mode-switch" role="tablist" aria-label="Query plan">
            <button role="tab" aria-selected={mode === 'semantic'} className={mode === 'semantic' ? 'active' : ''} onClick={() => changeMode('semantic')}>
              <small>Unoptimized</small><strong>Semantic query</strong><span>Reduce → Unnest</span>
            </button>
            <button role="tab" aria-selected={mode === 'optimized'} className={mode === 'optimized' ? 'active' : ''} onClick={() => changeMode('optimized')}>
              <small>O3 rewrite</small><strong>Optimized query</strong><span>Detect → Track → Join</span>
            </button>
          </div>

          <div className="query-code">
            <span>VRA</span>
            <code>{mode === 'semantic'
              ? 'Unnestₐ ( Reduce∅, Sem_Associate → A ( Rₘ ) )'
              : 'Mapₜₒ_ₐₛₛₒ꜀ ( Resolve₁:₁ ( Joinₚ,ₛ ( Track ( Detect ( Rₘ ) ) ) ) )'}</code>
            <em>recorded</em>
          </div>

          <PipelineExplorer stages={stages} active={stage} onChange={setStage} onRun={runReplay} running={running} />

          <SynchronizedVideos
            cameras={data.manifest.cameras}
            duration={data.manifest.duration}
            stage={mode === 'semantic' ? 0 : stage}
            detections={data.detections}
            tracks={data.tracks}
            candidates={data.candidates}
            trajectories={data.optimizedTrajectories}
            selectedTrajectory={selected}
          />

          <div className="output-panel">
            <div className="output-heading">
              <div><span className="eyebrow">Operator output</span><h3>Matched trajectories</h3></div>
              <span>{visibleTrajectories.length} records</span>
            </div>
            {visibleTrajectories.length ? (
              <div className="trajectory-grid">
                {visibleTrajectories.map((trajectory, index) => (
                  <button
                    className={[
                      'trajectory',
                      selected?.vehicleId === trajectory.vehicleId ? 'active' : '',
                      trajectory.falsePositive ? 'false-positive' : '',
                    ].filter(Boolean).join(' ')}
                    key={`${trajectory.vehicleId}-${index}`}
                    onClick={() => setSelected(trajectory)}
                  >
                    <span className="vehicle-id">{trajectoryPairLabel(trajectory)}</span>
                    <strong>{trajectory.attributes.color} {trajectory.attributes.subtype}</strong>
                    <small>{trajectory.timeline.map((item) => cameraLetter(item.cameraId)).join(' → ')}</small>
                    <em>{trajectory.falsePositive
                      ? 'false positive'
                      : trajectory.matchScore ? `${(trajectory.matchScore * 100).toFixed(1)}% match` : 'semantic match'}</em>
                  </button>
                ))}
              </div>
            ) : (
              <div className="empty-output"><span>{String(stage + 1).padStart(2, '0')}</span><p>Step through to <strong>{stages.at(-1)?.name}</strong> to inspect trajectory rows.</p></div>
            )}
          </div>
        </section>

        <MetricsComparison semantic={data.manifest.publishedMetrics.semantic} optimized={data.manifest.publishedMetrics.optimized} />

        <section className="paper-section">
          <span className="eyebrow">Read the research</span>
          <h2>Concord: A Video Relational Algebra for Cross-Modal Query Optimization</h2>
          <p>Sultan Muratbek, Charisse Ivana Yeung, Chanwut Kittivorawong, and Alvin Cheung.</p>
          <div><a href="https://github.com/chanwutk/mmds" target="_blank"><GitBranch size={16} /> MMDS repository</a><a href="https://i24motion.org/" target="_blank">I-24 MOTION dataset <ExternalLink size={14} /></a></div>
        </section>
      </main>
      <footer><span>Concord · UC Berkeley</span><span>Static replay · no inference</span></footer>
    </div>
  )
}

export default App
