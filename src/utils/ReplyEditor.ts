export const insertReplyNode = (editor: HTMLElement, replyNode: HTMLElement, selection: Selection) => {
  const previous = editor.querySelector('#replyDiv')
  if (previous) previous.replaceWith(replyNode)
  else editor.insertBefore(replyNode, editor.firstChild)

  if (!replyNode.nextSibling) editor.appendChild(document.createElement('br'))
  const caret = document.createRange()
  caret.selectNodeContents(editor)
  caret.collapse(false)
  selection.removeAllRanges()
  selection.addRange(caret)
}
