import test from 'node:test'
import assert from 'node:assert/strict'
import { Window } from 'happy-dom'
import { createPlayer } from '../player.js'
import { blankProject, upgradeProject } from '../model.js'

test('播放器快存快读、回退、重选、跨周目解锁与自动续读', async t => {
  const window = new Window(), previous = { window: globalThis.window, document: globalThis.document, Node: globalThis.Node }
  Object.assign(globalThis, { window, document: window.document, Node: window.Node })
  const p = upgradeProject(blankProject('存档回归', 'save-test')), s = p.scenes[0]
  p.variables = [{ id: 'trust', name: '好感', initial: 0, kind: 'affinity' }, { id: 'unlocked', name: '见过结局', initial: false, kind: 'boolean', scope: 'global' }]
  s.commands = [{ id: 'a', type: 'say', speakerId: '', text: '开场' }, { id: 'choose', type: 'choice' }]
  s.choices = [{ id: 'go', text: '选择', targetId: 'end', condition: null, effects: [{ variableId: 'trust', op: 'add', value: 1 }] }]
  p.scenes.push({ ...structuredClone(s), id: 'end', title: '结局', ending: true, choices: [], commands: [{ id: 'unlock', type: 'set', variableId: 'unlocked', op: 'set', value: true }, { id: 'b', type: 'say', speakerId: '', text: '最后一句' }] })
  const storage = window.localStorage, sdk = { storage: { local: storage } }
  storage.setItem('novel-v2-save-test-settings', JSON.stringify({ textSpeed: 0 }))
  let player = createPlayer(p, sdk, { assetUrl: id => id, onExit() {} }); document.body.append(player.root)
  t.after(async () => { player.dispose(); await window.happyDOM.close(); Object.assign(globalThis, previous) })
  const click = label => { const node = [...player.root.querySelectorAll('button')].find(x => x.textContent === label); assert.ok(node, label); node.click() }
  click('设置'); assert.deepEqual([...player.root.querySelectorAll('.novel-player-overlay input')].map(node => node.value), ['0', '1800', '0.6', '0.7']); click('关闭 ×')
  player.root.querySelector('.novel-dialogue').click(); assert.equal(player.getState().current.type, 'choice')
  click('快存'); click('选择'); assert.equal(player.getState().values.trust, 1); assert.equal(player.getState().values.unlocked, true)
  click('回退'); assert.equal(player.getState().values.trust, 0); assert.equal(player.getState().values.unlocked, true)
  click('选择'); assert.equal(player.getState().values.trust, 1, '重选只加一次好感')
  click('快读'); assert.equal(player.getState().values.trust, 0); assert.equal(player.getState().values.unlocked, true)
  click('选择'); player.root.querySelector('.novel-dialogue').click(); assert.equal(player.getState().ended, true)
  const profile = JSON.parse(storage.getItem('novel-v2-save-test-profile')); assert.deepEqual(profile.endings, ['end']); assert.ok(Object.keys(profile.read).some(key => key.startsWith('end:b:')))
  player.dispose(); player.root.remove()
  player = createPlayer(p, sdk, { assetUrl: id => id, onExit() {} }); document.body.append(player.root)
  assert.equal(player.getState().ended, true)
  click('重新开始'); assert.equal(player.getState().values.trust, 0); assert.equal(player.getState().values.unlocked, true)
})

test('历史回跳准确区分重复对白，经过等待、读档和重新开始仍恢复对应变量', async t => {
  const window = new Window(), previous = { window: globalThis.window, document: globalThis.document, Node: globalThis.Node }
  Object.assign(globalThis, { window, document: window.document, Node: window.Node })
  const p = upgradeProject(blankProject('历史回归', 'history-test')), s = p.scenes[0]
  p.variables = [{ id: 'count', name: '访问次数', initial: 0, kind: 'number' }]
  s.commands = [{ id: 'a', type: 'say', speakerId: '', text: '第一句' }, { id: 'add', type: 'set', variableId: 'count', op: 'add', value: 1 }, { id: 'b', type: 'say', speakerId: '', text: '第二句' }, { id: 'wait', type: 'wait', duration: 30000 }, { id: 'c', type: 'say', speakerId: '', text: '第三句' }, { id: 'choice', type: 'choice' }]
  s.choices = [{ id: 'again', text: '再走一遍', targetId: s.id, condition: null, effects: [] }]
  const storage = window.localStorage, sdk = { storage: { local: storage } }
  storage.setItem('novel-v2-history-test-settings', JSON.stringify({ textSpeed: 0 }))
  const player = createPlayer(p, sdk, { assetUrl: id => id, onExit() {} }); document.body.append(player.root)
  t.after(async () => { player.dispose(); await window.happyDOM.close(); Object.assign(globalThis, previous) })
  const click = label => { const node = [...player.root.querySelectorAll('button')].find(x => x.textContent === label); assert.ok(node, label); node.click() }
  const next = () => window.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'ArrowRight' }))
  click('快读'); assert.equal(player.root.querySelector('[role=status]').textContent, '没有可读取的快捷存档')
  next(); next(); next(); next(); click('再走一遍'); next(); next(); next()
  assert.equal(player.getState().current.id, 'c'); assert.equal(player.getState().values.count, 2)
  click('快存'); click('回退'); assert.equal(player.getState().current.id, 'b', '回退跳过等待指令，回到上一句对白'); click('快读'); click('历史')
  let rows = [...player.root.querySelectorAll('.novel-history-line')]
  assert.equal(rows.length, 6); assert.equal(rows[5].querySelector('button'), null, '当前对白不能回到自身')
  rows[4].querySelector('button').click()
  assert.equal(player.getState().current.id, 'b'); assert.equal(player.getState().values.count, 2)
  click('历史'); rows = [...player.root.querySelectorAll('.novel-history-line')]; rows[1].querySelector('button').click()
  assert.equal(player.getState().current.id, 'b'); assert.equal(player.getState().values.count, 1)
  click('历史'); rows = [...player.root.querySelectorAll('.novel-history-line')]; assert.equal(rows.length, 2); rows[0].querySelector('button').click()
  assert.equal(player.getState().current.id, 'a'); assert.equal(player.getState().values.count, 0)
  click('重新开始'); next(); click('历史'); rows = [...player.root.querySelectorAll('.novel-history-line')]
  assert.equal(rows.length, 2); assert.equal(rows[0].querySelector('p').textContent, '第一句'); rows[0].querySelector('button').click()
  assert.equal(player.getState().current.id, 'a'); assert.equal(player.getState().values.count, 0)
})

test('从跳转指令开始试玩会进入目标场景，条件不成立时跳过', async t => {
  const window = new Window(), previous = { window: globalThis.window, document: globalThis.document, Node: globalThis.Node }
  Object.assign(globalThis, { window, document: window.document, Node: window.Node })
  const p = upgradeProject(blankProject('跳转试玩', 'jump-test')), s = p.scenes[0]
  p.variables = [{ id: 'go', name: '允许跳转', initial: true, kind: 'boolean' }]
  s.commands = [{ id: 'jump', type: 'jump', targetId: 'target', condition: { variableId: 'go', op: 'eq', value: true } }, { id: 'stay', type: 'say', speakerId: '', text: '留在原处' }]
  p.scenes.push({ ...structuredClone(s), id: 'target', commands: [{ id: 'arrived', type: 'say', speakerId: '', text: '已经抵达' }] })
  const sdk = { storage: { local: window.localStorage } }
  let player = createPlayer(p, sdk, { startSceneId: s.id, startCommandId: 'jump', assetUrl: id => id, onExit() {} })
  t.after(async () => { player.dispose(); await window.happyDOM.close(); Object.assign(globalThis, previous) })
  assert.equal(player.getState().sceneId, 'target'); assert.equal(player.getState().current.id, 'arrived')
  player.dispose()
  player = createPlayer(p, sdk, { startSceneId: s.id, startCommandId: 'jump', previewValues: { go: false }, assetUrl: id => id, onExit() {} })
  assert.equal(player.getState().sceneId, s.id); assert.equal(player.getState().current.id, 'stay')
})
