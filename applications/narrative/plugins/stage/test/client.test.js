import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Window } from 'happy-dom'
import stagePlugin from '../client.js'

test('布景表单保留焦点并保存预览，舞台切换到运行状态，卸载后释放订阅', async t => {
  const window = new Window(), previous = globalThis.document
  globalThis.document = window.document
  t.after(async () => { globalThis.document = previous; await window.happyDOM.close() })
  const scene = (id, background, characterId = 'lin') => ({ id, title: id, stage: { background, characterId, expression: 'neutral', position: 50, scale: 100 } })
  let project = {
    assets: ['garden', 'station', 'neutral', 'happy'].map(id => ({ id, name: id, kind: 'image', url: `https://example.test/${id}.png` })),
    characters: [{ id: 'lin', name: '林栀', portrait: 'neutral', expressions: { neutral: 'neutral', happy: 'happy', sad: '' } }],
    nodes: [scene('first', 'garden'), scene('second', 'station', '')],
  }
  const observers = new Set(), cleanups = []
  let panel, surface, updates = 0
  const emit = type => { for (const callback of [...observers]) callback({ type }) }
  const engine = {
    get project() { return project }, mode: 'edit', held: false, selection: { nodeId: 'first' }, runtime: null,
    scene() { return project.nodes.find(node => node.id === this.selection.nodeId) },
    asset(id) { return project.assets.find(asset => asset.id === id)?.url || '' },
    update(mutator, options) { assert.equal(options.render, false); const next = structuredClone(project); mutator(next); project = next; updates++; emit('project') },
    observe(owner, callback) { observers.add(callback); const off = () => observers.delete(callback); owner.effect(() => off); return off },
    error(message) { assert.fail(message) },
  }
  const ctx = { narrative: engine, narrativeUI: {
    registerPanel(owner, descriptor) { assert.equal(owner, ctx); panel = descriptor },
    registerSurface(owner, descriptor) { assert.equal(owner, ctx); surface = descriptor },
  }, effect(callback) { cleanups.push(callback()) } }
  stagePlugin(ctx)
  const canvas = document.createElement('div'), editor = document.createElement('div')
  document.body.append(canvas, editor)
  const disposeStage = surface.mount(canvas), disposePanel = panel.render(editor)
  assert.equal(canvas.querySelector('.ne-stage-background').getAttribute('src'), 'https://example.test/garden.png')
  const sliders = editor.querySelectorAll('input[type=range]')
  sliders[0].focus(); sliders[0].value = '73'
  sliders[0].dispatchEvent(new window.Event('input', { bubbles: true }))
  assert.equal(project.nodes[0].stage.position, 73)
  assert.equal(document.activeElement, sliders[0])
  assert.equal(editor.querySelector('output').value, '73%')
  assert.equal(canvas.firstElementChild.style.getPropertyValue('--ne-stage-position'), '73%')
  assert.equal(editor.querySelector('.ne-stage').style.getPropertyValue('--ne-stage-position'), '73%')
  const expression = editor.querySelectorAll('select')[2]
  expression.value = 'happy'; expression.dispatchEvent(new window.Event('change'))
  assert.equal(canvas.querySelector('.ne-stage-portrait').getAttribute('src'), 'https://example.test/happy.png')
  assert.equal(updates, 2)
  engine.selection.nodeId = 'second'; emit('selection')
  assert.equal(canvas.querySelector('.ne-stage-background').getAttribute('src'), 'https://example.test/station.png')
  assert.equal(canvas.querySelector('.ne-stage-portrait').hidden, true)
  engine.mode = 'play'
  engine.runtime = { stage: { background: 'garden', characterId: 'lin', expression: 'happy', position: 25, scale: 130 } }
  emit('mode'); emit('runtime')
  assert.equal(canvas.querySelector('.ne-stage-portrait').getAttribute('src'), 'https://example.test/happy.png')
  assert.equal(canvas.firstElementChild.style.getPropertyValue('--ne-stage-scale'), '1.3')
  assert.equal(editor.querySelector('fieldset').disabled, true)
  engine.runtime.stage.expression = 'sad'; emit('runtime')
  assert.equal(canvas.querySelector('.ne-stage-portrait').getAttribute('src'), 'https://example.test/neutral.png')
  engine.runtime.stage = {}; emit('runtime')
  assert.equal(canvas.querySelector('.ne-stage-background').hidden, true)
  assert.equal(canvas.querySelector('.ne-stage-portrait').hidden, true)
  disposeStage(); disposePanel()
  assert.equal(observers.size, 0)
  assert.equal(canvas.childElementCount + editor.childElementCount, 0)
  for (const cleanup of cleanups.reverse()) cleanup?.()
  emit('project')
  assert.equal(canvas.childElementCount, 0)
})
