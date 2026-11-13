import test from 'node:test'
import assert from 'node:assert/strict'
import { Window } from 'happy-dom'
import { createStage } from '../stage.js'
import { initialState } from '../engine.js'
import { blankProject, upgradeProject } from '../model.js'
import { animationPresets } from '../effects.js'

test('富文本保留注音与逐字显示且不解析 HTML；天气、动画与震动在恢复时不误重播', async t => {
  const window = new Window(), previous = {window:globalThis.window,document:globalThis.document,Node:globalThis.Node}
  Object.assign(globalThis,{window,document:window.document,Node:window.Node})
  const calls=[]
  window.HTMLElement.prototype.animate = function(frames,options) { const call={node:this,frames,options,cancelled:false};calls.push(call);return {cancel(){call.cancelled=true}} }
  const p=upgradeProject(blankProject('特效渲染','render-effects')), state=initialState(p), stage=createStage(p,id=>id)
  document.body.append(stage.root)
  t.after(async()=>{stage.dispose();await window.happyDOM.close();Object.assign(globalThis,previous)})
  state.current={type:'say',text:'明天<img>',mode:'subtitle',segments:[{text:'明天',ruby:'あした',color:'#ffd99a',bold:true,italic:false},{text:'<img>',ruby:'',color:'#fff',bold:false,italic:true}]}
  state.stage.weather={effect:'sakura',intensity:.4,speed:1}
  state.stage.animations.background={target:'background',characterId:'',animation:structuredClone(animationPresets[2]),nonce:1}
  state.stage.shake={id:'shake',nonce:1,strength:2,duration:600,frequency:14}
  stage.render(state,{instant:true});stage.reveal(1)
  assert.equal(stage.text.textContent,'明');assert.equal(stage.text.querySelector('rt'),null)
  stage.reveal();assert.equal(stage.text.querySelector('rt').textContent,'あした');assert.equal(stage.text.querySelector('img'),null);assert.ok(stage.text.textContent.includes('<img>'))
  assert.equal(stage.root.dataset.dialogueMode,'subtitle');assert.equal(stage.root.querySelectorAll('.novel-particle').length,36)
  stage.render(state);assert.equal(calls.length,0,'恢复后的下一句不能重播震动或一次性动画')
  state.stage.animations.background.nonce++;state.stage.shake.nonce++;stage.render(state)
  assert.equal(calls.length,2);assert.equal(calls[0].options.iterations,1)
  stage.render(state);assert.equal(calls.length,2,'同一效果不因推进对白而重播')
  state.stage.animations={};state.stage.weather.effect='none';stage.render(state)
  assert.equal(calls[0].cancelled,true);assert.equal(stage.root.querySelectorAll('.novel-particle').length,0)
  state.stage.shake=null
  state.stage.camera={...state.stage.camera,from:{x:0,y:0,scale:1,rotation:0},scale:1.15,nonce:1}
  stage.render(state);assert.equal(calls.length,3,'首次挂载后的镜头也有明确过渡起点')
  assert.match(calls[2].frames[0].transform,/scale\(1\)/);assert.match(calls[2].frames[1].transform,/scale\(1.15\)/)
  stage.render(state,{instant:true});assert.equal(calls[2].cancelled,true)
  stage.render(state);assert.equal(calls.length,3,'读档后镜头不误重播')
})
