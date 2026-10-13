import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createStore } from '../applications/studio/plugins/canvas/store.js'
import { createNodeRegistry, createRegistry } from '../applications/studio/plugins/canvas/registry.js'
import { definitions } from '../applications/studio/plugins/canvas-basic-cards/definitions.js'
import groupServer from '../applications/studio/plugins/canvas-groups/server.js'
import groupClient from '../applications/studio/plugins/canvas-groups/client.js'
import { cardBounds } from '../applications/studio/plugins/canvas-ui/geometry.js'
import { owner } from './helpers/studio-fixture.js'
import { writeSnapshot } from '../shared/persistence.js'

async function fixture(t) {
  const directory=await mkdtemp(join(tmpdir(),'cordis-studio-groups-')), types=createNodeRegistry(), base=owner(), plugin=owner()
  for(const definition of definitions) types.register(base,definition)
  groupServer({...plugin,canvasDocuments:{types}})
  const store=await createStore(directory,writeSnapshot,types), board=()=>store.read().boards[0], history=[]
  const actions=createRegistry(), edit=async ops=>{const result=await store.edit(board().id,board().revision,ops);history.push(result.inverse);return result}
  const selection=[]
  groupClient({...plugin,canvasSession:{actions,board,edit},canvasUI:{bounds:nodes=>cardBounds(nodes,n=>({width:n.width||340,height:n.height||240})),select:ids=>selection.splice(0,selection.length,...ids),register(){},menu(){}}})
  await edit([{type:'add',node:{id:'a',type:'text',text:'原有文字',x:10,y:20}},{type:'add',node:{id:'b',type:'text',text:'参考要求',x:400,y:60}}])
  t.after(async()=>{await plugin.dispose();await base.dispose(); const target=resolve(directory);assert.ok(target.startsWith(resolve(tmpdir())+ '\\')||target.startsWith(resolve(tmpdir())+'/'));assert.ok(target.includes('cordis-studio-groups-'));await rm(target,{recursive:true,force:true})})
  return {directory,types,store,board,edit,history,actions,selection,plugin}
}

test('编组和取消编组跨 JSON 撤销重做，恢复成员及尺寸',async t=>{
  const f=await fixture(t)
  const {id}=await f.actions.require('group').run({ids:['a','b']})
  const grouped=f.board().nodes
  assert.equal(grouped.find(n=>n.id===id).width,778)
  assert.equal(grouped.filter(n=>n.groupId===id).length,2)
  await f.actions.require('ungroup').run({ids:['a']})
  assert.equal(f.board().nodes.length,2)
  assert.equal(Object.hasOwn(f.board().nodes[0],'groupId'),false)
  const restored=await f.edit(JSON.parse(JSON.stringify(f.history.at(-1))))
  assert.deepEqual(f.board().nodes,grouped)
  await f.edit(restored.inverse)
  assert.equal(f.board().nodes.length,2)
})

test('停用分组插件与重新打开数据均保留画板、成员和旧节点',async t=>{
  const f=await fixture(t)
  const {id}=await f.actions.require('group').run({ids:['a','b']})
  await f.plugin.dispose()
  assert.equal(f.actions.get('group'),undefined)
  await f.edit([{type:'update',id,patch:{x:80}}])
  const reopened=await createStore(f.directory,writeSnapshot,f.types)
  assert.equal(reopened.read().boards[0].nodes.find(n=>n.id==='a').text,'原有文字')
  assert.equal(reopened.read().boards[0].nodes.find(n=>n.id==='b').groupId,id)
})

test('拒绝悬空或嵌套分组，失败的批次不破坏原文档',async t=>{
  const f=await fixture(t)
  const {id}=await f.actions.require('group').run({ids:['a','b']})
  const before=f.board()
  for(const ops of [[{type:'remove',ids:[id]}],[{type:'update',id,patch:{groupId:id}}],[{type:'update',id:'a',patch:{groupId:'missing'}}],[{type:'update',id:'a',patch:{width:-1}}]]) await assert.rejects(f.edit(ops))
  assert.deepEqual(f.board(),before)
  const removed=await f.edit([{type:'remove',ids:[id,'a','b']}])
  await f.edit(removed.inverse)
  assert.deepEqual(f.board().nodes,before.nodes)
})
