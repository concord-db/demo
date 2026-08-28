import { ArrowRight, ChevronLeft, ChevronRight, Play } from 'lucide-react'

export interface Stage {
  name: string
  short: string
  detail: string
  count?: number
}

interface Props {
  stages: Stage[]
  active: number
  onChange: (index: number) => void
  onRun: () => void
  running: boolean
}

export function PipelineExplorer({
  stages,
  active,
  onChange,
  onRun,
  running,
}: Props) {
  const stage = stages[active]
  return (
    <div className="pipeline-explorer">
      <div className="pipeline" role="list" aria-label="Operator stages">
        {stages.map((item, index) => (
          <div className="pipeline-item" key={item.name}>
            <button
              role="listitem"
              aria-label={`${item.name}: ${item.short}`}
              className={index === active ? 'operator active' : 'operator'}
              onClick={() => onChange(index)}
              aria-current={index === active ? 'step' : undefined}
            >
              <span className="operator-index">{String(index + 1).padStart(2, '0')}</span>
              <strong>{item.name}</strong>
              <small>{item.short}</small>
              {item.count !== undefined && <em>{item.count.toLocaleString()} rows</em>}
            </button>
            {index < stages.length - 1 && (
              <ArrowRight className="pipeline-arrow" size={17} aria-hidden="true" />
            )}
          </div>
        ))}
      </div>

      <div className="stage-detail">
        <div>
          <span className="eyebrow">Now inspecting</span>
          <h3>{stage.name}</h3>
          <p>{stage.detail}</p>
        </div>
        <div className="step-controls">
          <button
            onClick={() => onChange(Math.max(0, active - 1))}
            disabled={active === 0}
          >
            <ChevronLeft size={16} /> Previous
          </button>
          <button className="run-button" onClick={onRun} disabled={running}>
            <Play size={15} /> {running ? 'Replaying…' : 'Replay query'}
          </button>
          <button
            onClick={() => onChange(Math.min(stages.length - 1, active + 1))}
            disabled={active === stages.length - 1}
          >
            Next <ChevronRight size={16} />
          </button>
        </div>
      </div>
    </div>
  )
}
