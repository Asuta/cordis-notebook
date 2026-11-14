import test from 'node:test'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import { PARAMS } from '../mesh-avatar/compiled/runtime.js'

// Exercise the real playback adapter without requiring WebGL or loading images.
const bundle = await build({
  entryPoints: [fileURLToPath(new URL('../mesh-avatar/renderer.js', import.meta.url))],
  bundle: true, write: false, format: 'esm', platform: 'node',
  plugins: [{ name: 'native-avatar-fixture', setup(b) {
    b.onResolve({ filter: /^\.\/compiled\/runtime\.js$/ }, args => {
      if (args.importer.replaceAll('\\', '/').endsWith('/mesh-avatar/renderer.js')) return { path: 'avatar', namespace: 'fixture' }
    })
    b.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({
      contents: 'export const PARAMS = ' + JSON.stringify(PARAMS) + '; export async function loadMeshAvatar(canvas) { return canvas.avatar }', loader: 'js',
    }))
  } }],
})
const { createMeshRenderer } = await import('data:text/javascript;base64,' + Buffer.from(bundle.outputFiles[0].contents).toString('base64'))
const model = { motions: [] }

function fixture() {
  let ticks = 0, parameters = {}, voice = 0
  const avatar = {
    setAutoIdle() {}, setAutoMotion() {}, setExpression() {}, setSpeaking() {}, destroy() {},
    setVoiceLevel(value) { voice = value },
    setParameters(values) { parameters = values }, getParameters() { return parameters },
    // The upstream runtime rounds each advance independently.
    advance(seconds, fps = 60) { ticks += Math.round(seconds * fps) },
  }
  return { avatar, renderer: createMeshRenderer({ avatar }), get ticks() { return ticks }, get parameters() { return parameters }, get voice() { return voice } }
}

test('原生角色在不同刷新率和不均匀帧间隔下按真实时间播放', async () => {
  for (const hz of [30, 60, 120, 144, 240]) {
    const f = fixture(); await f.renderer.setModel(model, '')
    f.renderer.render(model, {}, 0)
    for (let frame = 1; frame <= hz * 4; frame++) f.renderer.render(model, {}, frame * 1000 / hz)
    assert.equal(f.ticks, 241, hz + ' Hz 下的四秒动画时长')
  }
  const f = fixture(); await f.renderer.setModel(model, '')
  f.renderer.render(model, {}, 0)
  for (let elapsed = 0, frame = 0; elapsed < 4000; frame++) {
    elapsed = Math.min(4000, elapsed + [4, 7, 12, 25, 9][frame % 5])
    f.renderer.render(model, {}, elapsed)
  }
  assert.equal(f.ticks, 241, '零碎帧时间不丢失，也不重复推进')
})

test('原生角色限制后台恢复的补帧，并在姿态重置或模型重载时清空时间余量', async () => {
  const f = fixture(); await f.renderer.setModel(model, '')
  f.renderer.render(model, {}, 0); f.renderer.render(model, {}, 5)
  assert.equal(f.ticks, 1)
  f.renderer.render(model, {}, 30005)
  assert.equal(f.ticks, 7, '长时间挂起后最多补进 0.1 秒')
  f.renderer.reset(); f.renderer.render(model, {}, 0); f.renderer.render(model, {}, 12)
  assert.equal(f.ticks, 8, '重置后不带入之前剩余的 5 毫秒')
  await f.renderer.setModel(model, ''); f.renderer.render(model, {}, 0); f.renderer.render(model, {}, 12)
  assert.equal(f.ticks, 9, '模型重载后不带入之前的时间余量')
  f.renderer.dispose(); f.renderer.render(model, {}, 1000)
  assert.equal(f.ticks, 9, '退出后不再推进')
})

test('高刷新率下剧情转头参数和口型继续传入原生角色', async () => {
  const f = fixture(); await f.renderer.setModel(model, '')
  for (let frame = 0; frame <= 144; frame++) f.renderer.render(model, { parameters: { angleX: -24 }, expressionId: 'shy' }, frame * 1000 / 144, .6)
  assert.equal(f.ticks, 61)
  assert.equal(f.parameters.angleX, -24)
  assert.equal(f.voice, .6)
})
