import { describe, expect, it } from 'vitest'
import { insertReplyNode } from './ReplyEditor'

describe('reply editor', () => {
  it('places an editable caret outside the reply when the draft is empty', () => {
    const editor = document.createElement('div')
    editor.contentEditable = 'true'
    document.body.appendChild(editor)
    const reply = document.createElement('div')
    reply.id = 'replyDiv'
    reply.contentEditable = 'false'
    const selection = window.getSelection()!
    insertReplyNode(editor, reply, selection)
    expect(editor.lastChild?.nodeName).toBe('BR')
    expect(selection.anchorNode).toBe(editor)
    expect(selection.isCollapsed).toBe(true)
    editor.remove()
  })

  it('preserves the draft when changing the quoted message', () => {
    const editor = document.createElement('div')
    editor.innerHTML = '<div id="replyDiv">old</div>draft'
    const reply = document.createElement('div')
    reply.id = 'replyDiv'
    reply.textContent = 'new'
    insertReplyNode(editor, reply, window.getSelection()!)
    expect(editor.textContent).toBe('newdraft')
    expect(editor.querySelectorAll('#replyDiv')).toHaveLength(1)
  })
})
