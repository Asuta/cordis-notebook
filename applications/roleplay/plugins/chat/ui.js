export function el(tag, className = '', ...children) {
  const node = document.createElement(tag)
  if (className) node.className = className
  for (const child of children.flat(Infinity)) {
    if (child === undefined || child === null || child === false) continue
    node.append(child instanceof Node ? child : document.createTextNode(String(child)))
  }
  return node
}

export function button(label, action, className = '') {
  const node = el('button', className, label)
  node.type = 'button'
  node.addEventListener('click', action)
  return node
}

export function field(label, control, hint = '') {
  return el('label', 'rp-field', el('span', 'rp-label', label), control, hint && el('small', 'rp-hint', hint))
}

export function textInput(value, action, placeholder = '') {
  const node = el('input', 'rp-input')
  node.value = value ?? ''
  node.placeholder = placeholder
  node.addEventListener('input', () => action(node.value))
  return node
}

export function textArea(value, action, placeholder = '', rows = 4) {
  const node = el('textarea', 'rp-input rp-textarea')
  node.value = value ?? ''
  node.placeholder = placeholder
  node.rows = rows
  node.addEventListener('input', () => action(node.value))
  return node
}

export function selectInput(value, options, action) {
  const node = el('select', 'rp-input rp-select')
  for (const [optionValue, label] of options) {
    const option = el('option', '', label)
    option.value = optionValue
    node.append(option)
  }
  node.value = value
  node.addEventListener('change', () => action(node.value))
  return node
}

export function toggle(checked, action, label) {
  const input = el('input')
  input.type = 'checkbox'
  input.checked = !!checked
  input.addEventListener('change', () => action(input.checked))
  return el('label', 'rp-toggle', input, el('span', '', label))
}

export const uid = () => crypto.randomUUID()
