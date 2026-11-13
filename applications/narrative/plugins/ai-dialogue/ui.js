export function el(tag, className = '', text = '') {
  const node = document.createElement(tag)
  node.className = className
  if (text) node.textContent = text
  return node
}
export function button(label, run, className = 'ne-button') {
  const node = el('button', className, label)
  node.type = 'button'
  node.addEventListener('click', run)
  return node
}
export function field(label, input, hint = '') {
  const root = el('label', 'ne-field')
  root.append(el('span', '', label), input)
  if (hint) root.append(el('small', 'ne-muted', hint))
  return root
}
export function input(value, onChange, { multiline = false, maxLength = 8000, type = 'text', event = 'input' } = {}) {
  const node = el(multiline ? 'textarea' : 'input', multiline ? 'ne-textarea' : 'ne-input')
  if (!multiline) node.type = type
  node.value = value ?? ''
  node.maxLength = maxLength
  node.addEventListener(event, () => onChange(node.value))
  return node
}
export function select(value, rows, onChange) {
  const node = el('select', 'ne-select')
  for (const [id, label] of rows) { const option = el('option', '', label); option.value = id; node.append(option) }
  node.value = value ?? ''
  node.addEventListener('change', () => onChange(node.value))
  return node
}
