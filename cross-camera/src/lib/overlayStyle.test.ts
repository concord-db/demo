import { describe, expect, it } from 'vitest'
import { nearestBox, paletteColor, scoreColor } from './overlayStyle'

describe('overlayStyle', () => {
  it('gives nearby tracks well-separated hues', () => {
    const a = paletteColor(0, 8).stroke
    const b = paletteColor(1, 8).stroke
    const c = paletteColor(2, 8).stroke
    expect(a).not.toBe(b)
    expect(b).not.toBe(c)
    expect(a).toMatch(/hsl\(\d+, 78%, \d+%\)/)
  })

  it('maps low scores to red and high scores to green', () => {
    expect(scoreColor(0.4)).toBe('hsl(0, 85%, 52%)')
    expect(scoreColor(1)).toBe('hsl(120, 85%, 52%)')
  })

  it('picks a single nearest box instead of stacking adjacent frames', () => {
    const boxes = [
      { frame: 26, id: 'a' },
      { frame: 27, id: 'b' },
      { frame: 28, id: 'c' },
    ]
    expect(nearestBox(boxes, 27)?.id).toBe('b')
    expect(nearestBox(boxes, 40)).toBeUndefined()
  })
})
