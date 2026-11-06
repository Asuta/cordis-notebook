export function el(tag, className = '', ...children) {
  const node = document.createElement(tag)
  if (className) node.className = className
  for (const child of children.flat(Infinity)) if (child !== undefined && child !== null) node.append(child instanceof Node ? child : document.createTextNode(String(child)))
  return node
}
export function button(label, action, className = '') {
  const node = el('button', className, label); node.type = 'button'
  node.addEventListener('click', action); return node
}
export function input(value, action, placeholder = '') {
  const node = el('input', 'novel-input'); node.value = value ?? ''; node.placeholder = placeholder
  node.addEventListener('input', () => action(node.value)); return node
}
export function area(value, action, placeholder = '') {
  const node = el('textarea', 'novel-input novel-area'); node.value = value ?? ''; node.placeholder = placeholder
  node.addEventListener('input', () => action(node.value)); return node
}
export function select(value, options, action) {
  const node = el('select', 'novel-input')
  for (const item of options) { const option = el('option', '', item.label); option.value = item.value; node.append(option) }
  node.value = value ?? ''; node.addEventListener('change', () => action(node.value)); return node
}
export function field(label, control, hint = '') { return el('label', 'novel-field', el('span', 'novel-label', label), control, hint ? el('small', '', hint) : '') }
export function heading(title, detail = '') { return el('div', 'novel-section-heading', el('h2', '', title), detail ? el('span', '', detail) : '') }
export const uid = () => crypto.randomUUID()
