export type SplitDirection = 'left' | 'right' | 'top' | 'bottom'
export type WindowRect = { x: number; y: number; width: number; height: number }

export const splitWindowRect = (area: WindowRect, direction: SplitDirection): WindowRect => {
  const leftWidth = Math.floor(area.width / 2)
  const topHeight = Math.floor(area.height / 2)
  switch (direction) {
    case 'left':
      return { ...area, width: leftWidth }
    case 'right':
      return { ...area, x: area.x + leftWidth, width: area.width - leftWidth }
    case 'top':
      return { ...area, height: topHeight }
    case 'bottom':
      return { ...area, y: area.y + topHeight, height: area.height - topHeight }
  }
}
