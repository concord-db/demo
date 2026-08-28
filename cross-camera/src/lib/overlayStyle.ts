export function paletteColor(index: number, count: number): { stroke: string; fill: string } {
  const n = Math.max(count, 1)
  const hue = n === 1 ? 16 : Math.round((index * 360) / n)
  const lightness = 52 + (index % 3) * 8
  return {
    stroke: `hsl(${hue}, 78%, ${lightness}%)`,
    fill: `hsla(${hue}, 78%, ${lightness}%, 0.22)`,
  }
}

export function scoreColor(score: number, min = 0.4, max = 1): string {
  const span = Math.max(0.001, max - min)
  const t = Math.min(1, Math.max(0, (score - min) / span))
  return `hsl(${Math.round(120 * t)}, 85%, 52%)`
}

export function nearestBox<T extends { frame: number }>(
  items: T[],
  frame: number,
  maxDelta = 1,
): T | undefined {
  let best: T | undefined
  let bestDelta = maxDelta + 1
  for (const item of items) {
    const delta = Math.abs(item.frame - frame)
    if (delta < bestDelta) {
      best = item
      bestDelta = delta
    }
  }
  return bestDelta <= maxDelta ? best : undefined
}
