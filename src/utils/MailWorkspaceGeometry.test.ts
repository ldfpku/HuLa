import { describe, expect, it } from 'vitest'
import { mailBounds, overlapsMail } from './MailWorkspaceGeometry'

describe('mail workspace geometry', () => {
  it('uses logical viewport coordinates and clips to the window', () => {
    expect(mailBounds(new DOMRect(64.5, 24, 900, 600), { width: 800, height: 600 })).toEqual({
      x: 64.5,
      y: 24,
      width: 735.5,
      height: 576
    })
    expect(mailBounds(new DOMRect(-5, -10, 100, 100), { width: 800, height: 600 })).toEqual({
      x: 0,
      y: 0,
      width: 95,
      height: 90
    })
    expect(mailBounds(new DOMRect(900, 0, 100, 100), { width: 800, height: 600 })).toBeNull()
  })

  it('only hides the child for visible overlays intersecting its area', () => {
    const bounds = { x: 64, y: 24, width: 736, height: 576 }
    expect(overlapsMail(bounds, new DOMRect(50, 40, 100, 40))).toBe(true)
    expect(overlapsMail(bounds, new DOMRect(0, 0, 64, 24))).toBe(false)
    expect(overlapsMail(bounds, new DOMRect(100, 100, 0, 50))).toBe(false)
  })
})
