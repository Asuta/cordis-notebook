import test from 'node:test'
import assert from 'node:assert/strict'
import { blankProject, upgradeProject, validateProject, commandIssues } from '../model.js'
import { initialState, advance, choose, previewState, restoreCheckpoint } from '../engine.js'
import { newCommand, syncLegacy } from '../model.js'
import { animationPresets } from '../effects.js'

function fixture() {
  const p = upgradeProject(blankProject('演出回归', 'test')), s = p.scenes[0]
  p.variables = [{ id: 'trust', name: '好感', kind: 'affinity', initial: 0 }, { id: 'unlock', name: '解锁', kind: 'boolean', scope: 'global', initial: false }]
  p.cast = [{ id: 'lin', name: '林汐', portraitId: 'portrait', color: '#fff', expressions: [{ id: 'smile', name: '微笑', portraitId: 'smile-img' }] }]
  s.commands = [
    { id: 'bg', type: 'background', assetId: 'station', duration: 500 },
    { id: 'music', type: 'music', assetId: 'rain', volume: .7, duration: 600 },
    { id: 'enter', type: 'show', characterId: 'lin', expressionId: '', x: 30, y: 0, scale: 1, opacity: 1, duration: 300 },
    { id: 'first', type: 'say', speakerId: 'lin', text: '第一句' },
    { id: 'change', type: 'show', characterId: 'lin', expressionId: 'smile', x: 65, y: 2, scale: 1.2, opacity: .9, duration: 400 },
    { id: 'trust', type: 'set', variableId: 'trust', op: 'add', value: 1 },
    { id: 'pause', type: 'wait', duration: 100 },
    { id: 'second', type: 'say', speakerId: 'lin', text: '第二句' },
    { id: 'branch', type: 'choice' },
  ]
  s.choices = [{ id: 'go', text: '继续', targetId: 'end', condition: { variableId: 'trust', op: 'gte', value: 1 }, effects: [{ variableId: 'trust', op: 'add', value: 2 }] }]
  p.scenes.push({ ...structuredClone(s), id: 'end', title: '结局', ending: true, choices: [], commands: [{ id: 'unlock', type: 'set', variableId: 'unlock', op: 'set', value: true }, { id: 'bye', type: 'say', speakerId: '', text: '结束' }] })
  return p
}

test('旧版作品升级为稳定的指令序列，保留原对白和选项且不修改源数据', () => {
  const old = blankProject('旧作品', 'old'), before = structuredClone(old)
  const p = upgradeProject(old)
  assert.deepEqual(old, before); assert.equal(p.schemaVersion, 2); validateProject(p)
  assert.deepEqual(p.scenes[0].commands, upgradeProject(old).scenes[0].commands)
  assert.equal(p.scenes[0].commands.find(c => c.type === 'say').text, old.scenes[0].lines[0].text)
  assert.deepEqual(upgradeProject(p), p)
})

test('演出推进、表情、条件分支和读档恢复完整舞台，重放不重复叠加变量', () => {
  const p = fixture(), first = advance(p, initialState(p)), saved = structuredClone(first)
  assert.equal(first.current.id, 'first'); assert.equal(first.stage.backgroundId, 'station'); assert.equal(first.stage.music.assetId, 'rain')
  const waiting = advance(p, first), second = advance(p, waiting), branch = advance(p, second)
  assert.equal(waiting.current.type, 'wait'); assert.equal(second.stage.portraits.lin.portraitId, 'smile-img'); assert.equal(second.values.trust, 1)
  const entered = choose(p, branch, 'go'); assert.equal(entered.values.trust, 3); assert.equal(entered.values.unlock, true)
  const restored = restoreCheckpoint(p, { revision: p.revision, state: saved })
  assert.equal(restored.stage.portraits.lin.x, 30); assert.equal(restored.values.trust, 0)
  const replay = choose(p, advance(p, advance(p, advance(p, restored))), 'go')
  assert.equal(replay.values.trust, 3); assert.deepEqual(first, saved)
  assert.throws(() => restoreCheckpoint(p, { revision: p.revision + 1, state: saved }), /版本/)
})

test('预览精确重建选中指令、允许测试变量，不写入作品或游玩状态', () => {
  const p = fixture(), before = structuredClone(p), state = previewState(p, p.startSceneId, 'second', { trust: 4 })
  assert.equal(state.current.id, 'second'); assert.equal(state.values.trust, 5); assert.equal(state.stage.portraits.lin.scale, 1.2)
  assert.deepEqual(p, before)
})

test('拒绝非法指令参数，并保护无交互的跳转循环', () => {
  const p = fixture(); p.scenes[0].commands[0].duration = -1
  assert.throws(() => validateProject(p), /时长/)
  p.scenes[0].commands = [{ id: 'loop', type: 'jump', targetId: p.startSceneId }]
  assert.throws(() => advance(p, initialState(p)), /循环/)
  p.scenes[0].commands[0].targetId = 'missing'
  assert.ok(commandIssues(p).some(x => x.includes('目标场景不存在')))
})

test('选中条件不成立的对白仅预览此前演出，试玩可继续到下一条有效指令', () => {
  const p = fixture(), s = p.scenes[0]
  s.commands.find(c => c.id === 'second').condition = { variableId: 'trust', op: 'gte', value: 10 }
  const state = previewState(p, s.id, 'second')
  assert.equal(state.current, null); assert.equal(state.lastSay.id, 'first')
  assert.equal(advance(p, state).current.type, 'choice')
})

test('镜头、滤镜、天气、震动和动画完整进入检查点，目标可替换、停止且切场景清理角色动画', () => {
  const p = fixture(), s = p.scenes[0]
  p.animations = structuredClone(animationPresets)
  const command = (type, fields) => ({ ...newCommand(type, p), id: type, ...fields })
  s.commands = [s.commands[2], command('camera', { x: 5, scale: 1.2 }), command('filter', { grayscale: .8 }), command('weather', { effect: 'snow' }), command('shake', { strength: 2 }), command('animate', { target: 'character', characterId: 'lin', animationId: 'breath' }), { id: 'line-a', type: 'say', speakerId: '', text: '之前' }, command('animate', { id: 'replace', target: 'character', characterId: 'lin', animationId: 'nod' }), { id: 'line-b', type: 'say', speakerId: '', text: '替换' }, command('animate', { id: 'stop', target: 'character', characterId: 'lin', animationId: '' }), command('animate', { id: 'bg-motion', target: 'background', animationId: 'push' }), { id: 'line-c', type: 'say', speakerId: '', text: '停止' }, { id: 'jump', type: 'jump', targetId: 'end' }]
  s.choices = []; syncLegacy(s)
  const a = advance(p, initialState(p)), b = advance(p, a), c = advance(p, b), d = advance(p, c)
  assert.equal(a.stage.camera.scale, 1.2); assert.equal(a.stage.filter.grayscale, .8); assert.equal(a.stage.weather.effect, 'snow'); assert.equal(a.stage.shake.strength, 2)
  assert.equal(a.stage.animations['character:lin'].animation.id, 'breath'); assert.equal(b.stage.animations['character:lin'].animation.id, 'nod')
  assert.notEqual(a.stage.animations['character:lin'].nonce, b.stage.animations['character:lin'].nonce)
  assert.equal(c.stage.animations['character:lin'], undefined); assert.equal(d.stage.animations.background.animation.id, 'push')
  assert.deepEqual(restoreCheckpoint(p, {revision:p.revision,state:a}), a)
  assert.deepEqual(previewState(p, s.id, 'line-a').stage, a.stage)
  const jumping = structuredClone(b); jumping.index = s.commands.length - 1
  assert.equal(advance(p, jumping).stage.animations['character:lin'], undefined)
})

test('旧版动画库可省略，拒绝失序关键帧、错误效果参数和不匹配的文字分段', () => {
  const p = upgradeProject(blankProject('参数验证', 'effects-test')), s = p.scenes[0]
  delete p.animations; assert.deepEqual(upgradeProject(p).animations, []); validateProject(p)
  p.animations = structuredClone(animationPresets); p.animations[0].keyframes[1].at = 1
  assert.throws(() => validateProject(p), /关键帧/); p.animations = []
  s.commands = [{...newCommand('camera',p),scale:NaN}]; assert.throws(() => validateProject(p), /演出效果/)
  s.commands = [{id:'styled',type:'say',speakerId:'',text:'明天',mode:'monologue',segments:[{text:'明天',color:'#ffd99a',bold:true,italic:false,ruby:'未来'}]}]
  validateProject(p); s.commands[0].text = '被修改'; assert.throws(() => validateProject(p), /文字样式/)
})
