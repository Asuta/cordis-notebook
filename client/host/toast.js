export function createToast(document) {
  // Keep ownership when a plugin removes a dialog that temporarily contains us.
  const node = document.querySelector('#toast') || document.createElement('div')
  node.id = 'toast'; node.setAttribute('role', 'alert')
  let timer
  return message => {
    const dialog = [...document.querySelectorAll('dialog[open]')].at(-1)
    ;(dialog || document.body).append(node)
    node.textContent = String(message); node.hidden = false
    clearTimeout(timer); timer = setTimeout(() => { node.hidden = true }, 6000)
  }
}
