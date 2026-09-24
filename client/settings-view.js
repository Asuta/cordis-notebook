import { normalizeConfig } from './config-schema.js'

/** A separate dialog keeps unfinished edits intact while plugin cards rerender. */
export function createSettingsView({ el, save, getSnapshot }) {
  const dialog = el('dialog', { id: 'plugin-settings', 'aria-labelledby': 'settings-title' })
  const form = el('form'), title = el('h2', { id: 'settings-title' }), description = el('p'), fields = el('div', { class: 'settings-fields' })
  const message = el('p', { class: 'settings-message', role: 'status' }), actions = el('div', { class: 'settings-actions' })
  const reset = el('button', { type: 'button' }, '恢复默认值'), refresh = el('button', { type: 'button', hidden: true }, '载入最新设置')
  const cancel = el('button', { type: 'button' }, '取消'), submit = el('button', { type: 'submit' }, '保存设置')
  actions.append(reset, refresh, cancel, submit); form.append(title, description, fields, message, actions); dialog.append(form); document.body.append(dialog)
  let plugin, controls = new Map(), saving = false, busy = false
  const setValues = values => { for (const [key, input] of controls) { if (input.type === 'checkbox') input.checked = values[key]; else input.value = String(values[key]) } }
  function update(snapshot, working) {
    if (!dialog.open || !plugin) return
    busy = working || !!snapshot.pendingConfig || !!snapshot.pendingSwitch
    const latest = snapshot.plugins.find(p => p.id === plugin.id)
    const conflict = !latest || latest.configRevision !== plugin.configRevision
    if (conflict && !saving) { message.textContent = '设置已在其他页面更新。你的输入已保留，请载入最新设置后再修改。'; refresh.hidden = false }
    submit.disabled = busy || saving || conflict
    reset.disabled = refresh.disabled = cancel.disabled = busy || saving
    for (const input of controls.values()) input.disabled = busy || saving
  }
  function open(next) {
    plugin = next; title.textContent = next.name + ' · 设置'; controls = new Map(); fields.replaceChildren()
    description.textContent = !next.enabled ? '插件已停用，保存后将在下次启用时生效。' : next.settings.mode === 'restart' ? '保存前会保护未保存的笔记，然后重新加载此插件和依赖它的界面。' : '保存后立即更新界面，无需重启插件。'
    for (const [key, field] of Object.entries(next.settings.fields)) {
      const label = el('label', { class: 'settings-field' }), text = el('span', {}, field.label)
      let input
      if (field.options) {
        input = el('select')
        for (const option of field.options) input.append(el('option', { value: String(option.value) }, option.label))
      } else input = el('input', { type: field.type === 'boolean' ? 'checkbox' : field.type === 'number' ? 'number' : 'text' })
      for (const key of ['min', 'max', 'step', 'maxLength']) if (field[key] !== undefined) input[key] = field[key]
      if (field.type !== 'boolean') input.required = true
      label.append(text, input); if (field.description) label.append(el('small', {}, field.description))
      controls.set(key, input); fields.append(label)
    }
    setValues(next.config); message.textContent = next.configError || ''; refresh.hidden = true
    if (!dialog.open) dialog.showModal()
    update(getSnapshot(), false)
  }
  reset.onclick = () => { setValues(normalizeConfig(plugin.settings)); message.textContent = '已填入默认值，点击保存设置后生效。' }
  refresh.onclick = () => { const next = getSnapshot().plugins.find(p => p.id === plugin.id); if (next) open(next) }
  cancel.onclick = () => { if (!busy && !saving) dialog.close() }
  dialog.addEventListener('cancel', event => { if (busy || saving) event.preventDefault() })
  form.onsubmit = async event => {
    event.preventDefault(); if (saving || busy || submit.disabled) return
    try {
      const input = Object.fromEntries([...controls].map(([key, control]) => [key, plugin.settings.fields[key].type === 'boolean' ? control.checked : plugin.settings.fields[key].type === 'number' ? control.value.trim() ? Number(control.value) : NaN : control.value]))
      const config = normalizeConfig(plugin.settings, input)
      saving = true; message.textContent = '正在保存并应用…'; update(getSnapshot(), true)
      await save(plugin, config)
      dialog.close()
    } catch (error) { message.textContent = error.message }
    finally { saving = false; update(getSnapshot(), false) }
  }
  return { open, update }
}
