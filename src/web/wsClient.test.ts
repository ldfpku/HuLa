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

describe('WebSocketClient.init', () => {
  it('does not reconnect when the same login inits again', async () => {
    const { WebSocketClient } = await import('./wsClient')
    const { tokenStore } = await import('./imClient')
    tokenStore.set({ uid: 'u1', token: 'tok-1', refreshToken: 'r1' })
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ code: 200, data: { ticket: 'tk' } })))
    vi.stubGlobal('fetch', fetchMock)
    const sockets: unknown[] = []
    vi.stubGlobal(
      'WebSocket',
      class {
        close = vi.fn()
        send = vi.fn()
        constructor() {
          sockets.push(this)
        }
      }
    )
    const ws = new WebSocketClient(() => {})
    await ws.init('c1')
    await ws.init('c1')
    await vi.waitFor(() => expect(sockets).toHaveLength(1))
    expect(fetchMock).toHaveBeenCalledTimes(1)

    tokenStore.set({ uid: 'u2', token: 'tok-2', refreshToken: 'r2' })
    await ws.init('c1')
    await vi.waitFor(() => expect(sockets).toHaveLength(2))
    ws.disconnect()
    vi.unstubAllGlobals()
  })
})
