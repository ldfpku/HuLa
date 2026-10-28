import { describe, expect, it } from 'vitest'
import { splitWindowRect } from './SplitWindow'

describe('splitWindowRect', () => {
  const area = { x: -1920, y: 40, width: 1919, height: 1039 }
  it('uses the work area and accounts for odd dimensions', () => {
    expect(splitWindowRect(area, 'left')).toEqual({ x: -1920, y: 40, width: 959, height: 1039 })
    expect(splitWindowRect(area, 'right')).toEqual({ x: -961, y: 40, width: 960, height: 1039 })
    expect(splitWindowRect(area, 'top')).toEqual({ x: -1920, y: 40, width: 1919, height: 519 })
    expect(splitWindowRect(area, 'bottom')).toEqual({ x: -1920, y: 559, width: 1919, height: 520 })
  })
})
