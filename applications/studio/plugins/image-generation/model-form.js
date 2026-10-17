import { getPath, setPath, mergeParameters } from './parameters.js'
import { modelKey } from './references.js'

export function createModelForm(view, s) {
  const { el, safe } = view, drafts = new Map()
  const prefix = (node, provider) => `${s.boardId}/${node.id}/${modelKey(provider.id, node.model)}/`
  return {
    hasErrors(node, provider) { return [...drafts].some(([key, value]) => key.startsWith(prefix(node, provider)) && value.error) },
    render(node, provider, model, onValidityChange = () => {}, layout, collapsed) {
      const form = el('div', { class: 'studio-model-parameters studio-scroll' }), key = modelKey(provider.id, node.model)
      const values = mergeParameters(model.defaults, (s.drafts.get(node.id)?.patch.modelParameters || node.modelParameters)?.[key] || {})
      for (const field of model.fields || []) {
        if (field.path === '/prompt' || ['enable_sync_mode', 'enable_base64_output'].includes(field.name)) continue
        const schema = field.schema, draftKey = prefix(node, provider) + field.path, saved = getPath(values, field.path)
        const row = el('div', { class: 'studio-model-field' }), error = el('small', { class: 'studio-field-error', role: 'status' })
        const label = (schema.title || field.path.slice(1).replaceAll('/', ' / ')) + (field.required ? ' *' : '')
        let input, parse, initial
        const enumeration = schema.enum || (Object.hasOwn(schema, 'const') ? [schema.const] : null)
        if (enumeration) {
          input = el('select'); input.append(el('option', { value: '' }, field.required ? '请选择' : '未指定'))
          enumeration.forEach((value, index) => input.append(el('option', { value: String(index) }, typeof value === 'string' ? value : JSON.stringify(value))))
          input.value = saved === undefined ? '' : String(enumeration.findIndex(value => JSON.stringify(value) === JSON.stringify(saved)))
          if (input.value === '-1') input.value = ''
          parse = () => input.value === '' ? undefined : structuredClone(enumeration[Number(input.value)])
        } else if (field.type === 'boolean') {
          input = el('select'); input.append(el('option', { value: '' }, '未指定'), el('option', { value: 'true' }, '开启'), el('option', { value: 'false' }, '关闭'))
          input.value = saved === undefined ? '' : String(saved); parse = () => input.value === '' ? undefined : input.value === 'true'
        } else if (['number', 'integer'].includes(field.type)) {
          input = el('input', { type: 'number', value: saved ?? '', step: schema.multipleOf || (field.type === 'integer' ? 1 : 'any') })
          if (schema.minimum !== undefined) input.min = schema.minimum
          if (schema.maximum !== undefined) input.max = schema.maximum
          parse = () => {
            if (input.validity?.badInput) throw Error('请输入有效数字')
            if (input.value === '') return undefined
            const value = Number(input.value)
            if (!Number.isFinite(value) || (field.type === 'integer' && !Number.isInteger(value))) throw Error(field.type === 'integer' ? '请输入整数' : '请输入有效数字')
            if ((schema.minimum !== undefined && value < schema.minimum) || (schema.maximum !== undefined && value > schema.maximum)) throw Error('数值超出模型允许的范围')
            return value
          }
        } else if (['object', 'array'].includes(field.type) || schema.oneOf || schema.anyOf) {
          input = el('textarea', { rows: 3, placeholder: 'JSON', value: saved === undefined ? '' : JSON.stringify(saved, null, 2) })
          parse = () => { if (!input.value.trim()) return undefined; try { return JSON.parse(input.value) } catch { throw Error('JSON 格式无效，请修正后再生成') } }
        } else {
          input = el((schema.maxLength || 0) > 200 || /prompt|description/.test(field.name) ? 'textarea' : 'input', { value: saved ?? '' })
          if (schema.maxLength) input.maxLength = Math.min(200000, schema.maxLength)
          parse = () => input.value === '' && !field.required ? undefined : input.value
        }
        input.setAttribute('aria-label', '参数 ' + field.path.slice(1)); input.dataset.parameter = field.path
        if (Object.hasOwn(schema, 'const')) input.disabled = true
        const draft = drafts.get(draftKey)
        if (draft) { input.value = draft.raw; error.textContent = draft.error || '' }
        initial = input.value
        input.onfocus = () => view.beginEditing(input)
        function stage() {
          if (input.value === initial && !drafts.has(draftKey)) return
          try {
            const value = parse()
            const parameters = structuredClone(s.drafts.get(node.id)?.patch.modelParameters || node.modelParameters || {})
            parameters[key] = structuredClone(parameters[key] || {}); setPath(parameters[key], field.path, value)
            s.draft(node, 'modelParameters', parameters)
            drafts.delete(draftKey); initial = input.value; error.textContent = ''
          } catch (failure) { error.textContent = failure.message; drafts.set(draftKey, { raw: input.value, error: failure.message }); throw failure }
          finally { onValidityChange() }
        }
        input.oninput = () => { try { stage() } catch {} }
        input.onchange = safe(async () => { stage(); await view.flush() })
        input.onblur = safe(async () => { try { stage(); await view.flush() } finally { view.endEditing(input); view.render() } })
        const hints = []
        if (schema.minimum !== undefined) hints.push('≥ ' + schema.minimum)
        if (schema.maximum !== undefined) hints.push('≤ ' + schema.maximum)
        if (schema.minItems !== undefined) hints.push('最少 ' + schema.minItems + ' 项')
        if (schema.maxItems !== undefined) hints.push('最多 ' + schema.maxItems + ' 项')
        if (Object.hasOwn(schema, 'default')) hints.push('默认 ' + JSON.stringify(schema.default))
        row.append(input)
        if (hints.length) row.append(el('small', {}, hints.join(' · ')))
        if (schema.description) row.append(el('small', { class: 'studio-parameter-description' }, schema.description))
        row.append(error)
        if (layout) { const visible = layout.parameter(node, key, field.path, label, saved, row, collapsed); if (visible) form.append(visible); else if (draft?.error) collapsed.append(el('small', { class: 'studio-field-error' }, label + '：' + draft.error)) }
        else { row.prepend(el('span', {}, label)); form.append(row) }
      }
      return form
    },
  }
}
