import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Window } from 'happy-dom'
import { createToast } from '../client/host/toast.js'

test('插件关闭并移除弹窗后，共用提示可重新挂载且只保留一个计时器',async t=>{
  const window=new Window(),d=window.document
  t.after(()=>window.happyDOM.close());t.mock.timers.enable({apis:['setTimeout']})
  const toast=createToast(d),dialog=d.createElement('dialog');d.body.append(dialog);dialog.showModal()
  toast('进度已保存');const node=d.querySelector('#toast');assert.equal(node.parentNode,dialog)
  dialog.close();dialog.remove();assert.equal(d.querySelector('#toast'),null)
  t.mock.timers.tick(3000);toast('正在播放音乐');assert.equal(d.querySelector('#toast'),node);assert.equal(node.parentNode,d.body)
  assert.equal(node.textContent,'正在播放音乐');assert.equal(d.body.textContent.includes('null'),false)
  t.mock.timers.tick(3000);assert.equal(node.hidden,false)
  t.mock.timers.tick(3000);assert.equal(node.hidden,true)
})
