import test from 'node:test'
import assert from 'node:assert/strict'
import { zipSync, strToU8 } from 'fflate'
import { blankProject, upgradeProject } from '../model.js'
import { importPackage } from '../package.js'
import { animationPresets } from '../effects.js'

test('第二版作品包重映射表情、背景、音乐、音效中的素材，保留连线位置与指令 ID', async () => {
  const p = upgradeProject(blankProject('作品包', 'package-test')), s = p.scenes[0]
  p.assets = [{ id: 'img', kind: 'image', mime: 'image/png', name: '立绘', size: 3 }, { id: 'audio', kind: 'audio', mime: 'audio/wav', name: '音乐', size: 3 }]
  p.cast = [{ id: 'lin', name: '林汐', portraitId: 'img', color: '#fff', expressions: [{ id: 'smile', name: '微笑', portraitId: 'img' }] }]
  s.position = { x: 400, y: 200 }
  s.commands = [{ id: 'bg', type: 'background', assetId: 'img', duration: 500 }, { id: 'bgm', type: 'music', assetId: 'audio', volume: .5, duration: 500 }, { id: 'sfx', type: 'sound', assetId: 'audio', volume: 1 }]
  p.animations = structuredClone(animationPresets)
  s.commands.push({id:'animation',type:'animate',target:'character',characterId:'lin',animationId:'breath'},{id:'ruby',type:'say',speakerId:'lin',text:'星光',mode:'subtitle',segments:[{text:'星光',color:'#fff',bold:true,italic:false,ruby:'希望'}]})
  const bytes = zipSync({ 'project.json': strToU8(JSON.stringify(p)), 'media/img': new Uint8Array([1, 2, 3]), 'media/audio': new Uint8Array([4, 5, 6]) })
  let created = blankProject('副本', 'copy'), count = 0
  const imported = await importPackage(new File([bytes], 'test.novel.zip'), async (path, method, data) => {
    if (path === '/api/novel/projects') return structuredClone(created)
    if (path.endsWith('/assets')) { created.assets.push({ ...p.assets[count], id: 'new-' + count++ }); created.revision++; return structuredClone(created) }
    if (method === 'PUT') return data
    throw Error('unexpected request')
  })
  assert.equal(imported.cast[0].portraitId, 'new-0'); assert.equal(imported.cast[0].expressions[0].portraitId, 'new-0')
  assert.deepEqual(imported.scenes[0].commands.slice(0,3).map(c => c.assetId), ['new-0', 'new-1', 'new-1'])
  assert.deepEqual(imported.scenes[0].position, s.position); assert.deepEqual(imported.scenes[0].commands.map(c => c.id), s.commands.map(c=>c.id))
  assert.deepEqual(imported.animations,p.animations);assert.deepEqual(imported.scenes[0].commands.slice(3),s.commands.slice(3))
})
