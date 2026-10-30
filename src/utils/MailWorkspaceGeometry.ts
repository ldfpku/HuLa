import type { MailViewBounds } from '@/services/EmbeddedMailController'

export function mailBounds(rect: DOMRect, viewport: { width: number; height: number }): MailViewBounds | null {
  const left = Math.max(0, rect.left)
  const top = Math.max(0, rect.top)
  const right = Math.min(viewport.width, rect.right)
  const bottom = Math.min(viewport.height, rect.bottom)
  if (right <= left || bottom <= top) return null
  return { x: left, y: top, width: right - left, height: bottom - top }
}

export function overlapsMail(bounds: MailViewBounds, rect: DOMRect): boolean {
  return (
    rect.width > 0 &&
    rect.height > 0 &&
    rect.left < bounds.x + bounds.width &&
    rect.right > bounds.x &&
    rect.top < bounds.y + bounds.height &&
    rect.bottom > bounds.y
  )
}
