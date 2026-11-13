import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Window } from 'happy-dom'
import charactersPlugin from '../client.js'
import { MAX_IMAGE_BYTES, readImageFile } from '../image.js'

test('编辑角色不丢焦点，删除时保留台词与素材并清空全部契约引用，停用清理面板', async t => {
  const window = new Window(), previous = globalThis.document
  globalThis.document = window.document
  t.after(async () => { globalThis.document = previous; await window.happyDOM.close() })
  const character = id => ({ id, name: id === 'lin' ? '林栀' : '遥', description: '', personality: '', portrait: 'portrait', expressions: { neutral: '', happy: '', sad: '' }, color: '#b59475' })
  let project = { id: 'work', characters: [character('lin'), character('yao')], assets: [{ id: 'portrait', name: '立绘', kind: 'image', url: 'https://example.test/portrait.png' }], nodes: [
    { id: 'one', stage: { characterId: 'lin' }, lines: [{ speaker: 'lin', text: '你好' }, { speaker: 'yao', text: '晚上好' }], chat: { characterId: 'lin' } },
    { id: 'two', stage: { characterId: 'yao' }, lines: [{ speaker: 'lin', text: '再见' }] },
  ] }
  const observers = new Set(), cleanups = []
  const notify = type => { for (const callback of [...observers]) callback({ type }) }
  let panel
  const engine = {
    get project() { return project }, mode: 'edit', held: false, selection: { characterId: 'lin' },
    asset(id) { return project.assets.find(asset => asset.id === id)?.url || '' },
    update(mutator, options) { assert.equal(options.render, false); const next = structuredClone(project); mutator(next); project = next; notify('project') },
    select(patch) { Object.assign(this.selection, patch); notify('selection') },
    observe(owner, callback) { observers.add(callback); const off = () => observers.delete(callback); owner.effect(() => off); return off },
  }
  const ctx = { narrative: engine, narrativeUI: { registerPanel(owner, descriptor) { assert.equal(owner, ctx); panel = descriptor } }, effect(callback) { cleanups.push(callback()) } }
  charactersPlugin(ctx)
  const container = document.createElement('div'); document.body.append(container)
  const dispose = panel.render(container)
  const name = container.querySelector('input[type=text]')
  name.focus(); name.value = '林间来信'; name.dispatchEvent(new window.Event('input'))
  assert.equal(document.activeElement, name)
  assert.equal(project.characters[0].name, '林间来信')
  assert.equal(container.querySelector('.ne-character-profile-name').textContent, '林间来信')
  name.value = ' '; name.dispatchEvent(new window.Event('input'))
  assert.equal(project.characters[0].name, '林间来信', '空草稿不能覆盖有效角色姓名')
  const selects = container.querySelectorAll('select')
  selects[2].value = 'portrait'; selects[2].dispatchEvent(new window.Event('change'))
  assert.equal(project.characters[0].expressions.happy, 'portrait')
  container.querySelector('.ne-characters-editor > .ne-danger').click()
  assert.equal(container.querySelector('.ne-character-deletion').hidden, false)
  container.querySelector('.ne-character-deletion .ne-danger').click()
  assert.equal(engine.selection.characterId, 'yao')
  assert.equal(project.characters.length, 1)
  assert.equal(project.nodes[0].stage.characterId, '')
  assert.equal(project.nodes[0].chat.characterId, '')
  assert.deepEqual(project.nodes[0].lines, [{ speaker: '', text: '你好' }, { speaker: 'yao', text: '晚上好' }])
  assert.equal(project.nodes[1].lines[0].speaker, '')
  assert.equal(project.nodes[1].stage.characterId, 'yao')
  assert.equal(project.assets.length, 1)
  container.querySelector('.ne-characters-heading button').click()
  const added = project.characters.find(character => character.id === engine.selection.characterId)
  assert.ok(added.id.startsWith('character-'))
  assert.deepEqual(added.expressions, { neutral: '', happy: '', sad: '' })
  engine.mode = 'play'; notify('mode')
  assert.equal(container.querySelector('fieldset').disabled, true)
  assert.equal(container.querySelector('.ne-characters-heading button').disabled, true)
  dispose()
  assert.equal(observers.size, 0)
  assert.equal(container.childElementCount, 0)
  for (const cleanup of cleanups.reverse()) cleanup?.()
})

test('上传拒绝超限、空文件、伪装格式与已取消的读取', async t => {
  await assert.rejects(readImageFile({ type: 'image/svg+xml', size: 20 }), /PNG、JPEG 或 WebP/)
  await assert.rejects(readImageFile({ type: 'image/png', size: MAX_IMAGE_BYTES + 1 }), /5 MB/)
  await assert.rejects(readImageFile({ type: 'image/png', size: 0 }), /文件为空/)
  const controller = new AbortController(); controller.abort()
  await assert.rejects(readImageFile({ type: 'image/png', size: 20 }, { signal: controller.signal }), { name: 'AbortError' })
  const previous = globalThis.FileReader
  globalThis.FileReader = class {
    readAsDataURL() { this.result = 'data:image/png;base64,SGVsbG8='; this.onload() }
  }
  t.after(() => { if (previous === undefined) delete globalThis.FileReader; else globalThis.FileReader = previous })
  await assert.rejects(readImageFile({ type: 'image/png', size: 5 }), /内容与文件类型不符/)
})
