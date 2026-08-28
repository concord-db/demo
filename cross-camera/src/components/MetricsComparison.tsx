import { Ban, Check, Clock, Sparkles } from 'lucide-react'
import type { MetricSet } from '../types'

interface Props {
  semantic: MetricSet
  optimized: MetricSet
}

const pct = (value: number) => `${(value * 100).toFixed(1)}%`

export function MetricsComparison({ semantic, optimized }: Props) {
  return (
    <section className="metrics-section" id="results">
      <div className="section-heading">
        <div>
          <span className="eyebrow">Published evaluation · Table 3</span>
          <h2>Better coverage, without an MLLM call</h2>
        </div>
        <p>
          Both queries were evaluated against the same 18 manually adjudicated
          cross-camera vehicles.
        </p>
      </div>

      <div className="metric-hero-grid">
        <article className="metric-hero baseline">
          <span>Semantic Reduce → Unnest</span>
          <strong>{semantic.f1.toFixed(3)}</strong>
          <small>F1 score</small>
        </article>
        <div className="metric-delta">
          <Sparkles size={19} />
          <strong>+{((optimized.f1 - semantic.f1) * 100).toFixed(1)}</strong>
          <span>F1 points</span>
        </div>
        <article className="metric-hero optimized">
          <span>Detect → Track → Join</span>
          <strong>{optimized.f1.toFixed(3)}</strong>
          <small>F1 score</small>
        </article>
      </div>

      <div className="comparison-table" role="table" aria-label="Published metrics">
        <div className="comparison-row comparison-head" role="row">
          <span role="columnheader">Metric</span>
          <span role="columnheader">Semantic</span>
          <span role="columnheader">Optimized</span>
        </div>
        {[
          ['Predicted trajectories', semantic.predictions, optimized.predictions],
          ['Precision', pct(semantic.precision), pct(optimized.precision)],
          ['Recall', pct(semantic.recall), pct(optimized.recall)],
          ['Timeline IoU', semantic.timelineIoU.toFixed(3), optimized.timelineIoU.toFixed(3)],
          ['Attribute exact', semantic.attributeExact.toFixed(3), optimized.attributeExact.toFixed(3)],
        ].map(([label, left, right]) => (
          <div className="comparison-row" role="row" key={label}>
            <span role="cell">{label}</span>
            <span role="cell">{left}</span>
            <span role="cell">{right}</span>
          </div>
        ))}
      </div>

      <div className="tradeoffs">
        <article>
          <Check size={18} />
          <div><strong>13 true positives</strong><span>versus 4 for the semantic baseline</span></div>
        </article>
        <article>
          <Ban size={18} />
          <div><strong>0 MLLM calls</strong><span>explicit, inspectable operators only</span></div>
        </article>
        <article>
          <Clock size={18} />
          <div><strong>99.6 seconds</strong><span>slower than 52.7s on this short clip</span></div>
        </article>
      </div>
      <p className="provenance-note">
        Values above are frozen publication results, not recomputed in your browser.
        The replay data is a separate recorded run and may vary with model versions.
      </p>
    </section>
  )
}
