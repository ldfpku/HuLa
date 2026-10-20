import { describe, expect, it, vi } from 'vitest'
import { fetchSocketTicket, TicketRefusedError } from './wsClient'

describe('fetchSocketTicket', () => {
  it('returns the ticket', async () => {
    await expect(fetchSocketTicket('t', async () => 'ticket-1')).resolves.toBe('ticket-1')
  })

  it('retries once, then falls back to the token parameter', async () => {
    const request = vi.fn(async () => {
      throw new Error('network')
    })
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    await expect(fetchSocketTicket('t', request)).resolves.toBeNull()
    expect(request).toHaveBeenCalledTimes(2)
  })

  it('does not fall back with a token the server refused', async () => {
    const request = vi.fn(async () => {
      throw new TicketRefusedError('401')
    })
    await expect(fetchSocketTicket('t', request)).rejects.toBeInstanceOf(TicketRefusedError)
    expect(request).toHaveBeenCalledTimes(1)
  })
})
