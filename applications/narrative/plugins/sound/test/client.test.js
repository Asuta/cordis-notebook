import { test } from 'node:test'
import assert from 'node:assert/strict'
import { setImmediate as nextTurn } from 'node:timers/promises'
import { Window } from 'happy-dom'
import sound from '../client.js'

function deferred() {
  let resolve, reject
  const promise = new Promise((accept, fail) => { resolve = accept; reject = fail })
  return { promise, resolve, reject }
}

function fixture(t, { volume = 0.35 } = {}) {
  const window = new Window({ url: 'https://narrative.test/' })
  const globals = new Map(['document', 'Audio'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]))
  const audios = [], toasts = [], cleanups = [], observers = new Set()
  const actions = new Map(), panels = new Map(), toolbars = new Map()
  let disposed = false
  let project = {
    id: 'first',
    assets: [
      { id: 'portrait', name: '立绘', kind: 'image', url: 'https://assets.test/portrait.png' },
      { id: 'theme', name: '默认配乐', kind: 'audio', url: 'https://assets.test/theme.wav' },
      { id: 'effect', name: '提示音', kind: 'audio', url: 'https://assets.test/effect.ogg' },
    ],
    settings: { bgm: 'theme', volume },
  }
  // A stopped request may still settle later: do not let pause/load settle it for the plugin.
  class AudioStub {
    constructor(src) {
      this.src = src
      this.paused = true
      this.loop = false
      this.volume = 1
      this.muted = false
      this.playCalls = 0
      this.pauseCalls = 0
      this.loadCalls = 0
      this.removedAttributes = []
      this.calls = []
      this.request = deferred()
      audios.push(this)
    }
    play() {
      this.playCalls++
      this.calls.push('play')
      this.paused = false
      return this.request.promise.then(() => { this.paused = false })
    }
    pause() { this.pauseCalls++; this.calls.push('pause'); this.paused = true }
    removeAttribute(name) {
      this.removedAttributes.push(name)
      this.calls.push('remove:' + name)
      if (name === 'src') this.src = ''
    }
    load() { this.loadCalls++; this.calls.push('load') }
  }
  const emit = type => { for (const callback of [...observers]) callback({ type }) }
  const register = (registry, owner, descriptor, key) => {
    registry.set(key, descriptor)
    owner.effect(() => () => registry.delete(key))
  }
  const engine = {
    get project() { return project }, mode: 'edit', held: false,
    asset(id) { return project.assets.find(asset => asset.id === id)?.url || '' },
    update(mutator, options = {}) {
      const next = structuredClone(project); mutator(next); project = next
      for (const callback of [...observers]) callback({ type: 'project', ...options })
    },
    registerAction(owner, descriptor) { register(actions, owner, descriptor, descriptor.type) },
    observe(owner, callback) {
      observers.add(callback)
      const off = () => observers.delete(callback)
      owner.effect(() => off)
      return off
    },
  }
  const ctx = {
    narrative: engine,
    narrativeUI: {
      registerPanel(owner, descriptor) { register(panels, owner, descriptor, descriptor.id) },
      registerToolbar(owner, descriptor) { register(toolbars, owner, descriptor, descriptor.id) },
    },
    effect(callback) { cleanups.push(callback()) },
    dispose() {
      if (disposed) return
      disposed = true
      for (const cleanup of cleanups.splice(0).reverse()) cleanup?.()
    },
  }
  t.after(async () => {
    try {
      ctx.dispose()
      for (const audio of audios) audio.request.resolve()
      await nextTurn()
    } finally {
      for (const [key, descriptor] of globals) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor)
        else delete globalThis[key]
      }
      await window.happyDOM.close()
    }
  })
  Object.defineProperty(globalThis, 'document', { configurable: true, writable: true, value: window.document })
  Object.defineProperty(globalThis, 'Audio', { configurable: true, writable: true, value: AudioStub })
  sound(ctx, { toast: message => toasts.push(message) })
  const execute = (type, action = {}) => actions.get(type).execute({ type, ...action })
  const render = () => {
    const container = document.createElement('section'); document.body.append(container)
    panels.get('sound').render(container)
    return container
  }
  const click = async (container, label) => {
    const button = [...container.querySelectorAll('button')].find(node => node.textContent === label)
    assert.ok(button, '找不到按钮：' + label)
    button.click(); await nextTurn()
  }
  return { window, ctx, engine, audios, toasts, actions, panels, toolbars, observers, emit, execute, render, click }
}

function assertReleased(audio) {
  assert.equal(audio.paused, true, '清理后必须暂停')
  assert.equal(audio.src, '', '清理后不得保留音频源')
  assert.deepEqual(audio.removedAttributes, ['src'])
  assert.equal(audio.loadCalls, 1, '清空音源后重置播放器')
  assert.ok(audio.pauseCalls >= 1)
}

test('play-audio 选中指定音频，保留 loop:false 和 volume:0，成功后才通知', async t => {
  const f = fixture(t, { volume: 0 })
  const pending = f.execute('play-audio', { asset: 'effect', loop: false })
  const audio = f.audios[0]
  assert.equal(audio.src, 'https://assets.test/effect.ogg')
  assert.equal(audio.loop, false)
  assert.equal(audio.volume, 0)
  assert.equal(audio.playCalls, 1)
  assert.deepEqual(f.toasts, [])
  audio.request.resolve(); await pending
  assert.equal(audio.paused, false)
  assert.deepEqual(f.toasts, ['正在播放：提示音'])
})

test('play-audio 空素材使用默认 BGM，默认循环并保留项目音量', async t => {
  const f = fixture(t)
  const pending = f.execute('play-audio', { asset: '' })
  const audio = f.audios[0]
  assert.equal(audio.src, 'https://assets.test/theme.wav')
  assert.equal(audio.loop, true)
  assert.equal(audio.volume, 0.35)
  audio.request.resolve(); await pending
  assert.deepEqual(f.toasts, ['正在播放：默认配乐'])
})

test('图片或缺失素材不能创建播放器，也不会中断正在播放的音频', async t => {
  const f = fixture(t)
  const playing = f.execute('play-audio', { asset: 'theme' })
  const audio = f.audios[0]
  audio.request.resolve(); await playing
  for (const asset of ['portrait', 'missing']) {
    await assert.rejects(f.execute('play-audio', { asset }), /选择音频素材/)
  }
  assert.equal(f.audios.length, 1)
  assert.equal(audio.paused, false)
  assert.equal(audio.loadCalls, 0)
  assert.deepEqual(f.toasts, ['正在播放：默认配乐'])
})

test('声音面板过滤素材，预听实际选中项，滑块将当前音量和保存值更新为 0', async t => {
  const f = fixture(t), container = f.render()
  const select = container.querySelector('select')
  assert.deepEqual([...select.options].map(option => option.value), ['', 'theme', 'effect'])
  select.value = 'effect'; select.dispatchEvent(new f.window.Event('change')); await nextTurn()
  assert.equal(f.engine.project.settings.bgm, 'effect')
  await f.click(container, '▶ 预听')
  const audio = f.audios[0]
  assert.equal(audio.src, 'https://assets.test/effect.ogg')
  assert.equal(audio.loop, true)
  assert.deepEqual(f.toasts, [])
  audio.request.resolve(); await nextTurn()
  const volume = container.querySelector('input[type=range]')
  volume.value = '0'; volume.dispatchEvent(new f.window.Event('input'))
  assert.equal(audio.volume, 0)
  volume.dispatchEvent(new f.window.Event('change')); await nextTurn()
  assert.equal(f.engine.project.settings.volume, 0)
  await f.click(container, '停止')
  assertReleased(audio)
  assert.deepEqual(f.toasts, ['正在播放：提示音', '音乐已停止'])
})

const cancellations = [
  ['stop-audio', f => f.execute('stop-audio')],
  ['mode 切换', f => { f.engine.mode = 'play'; f.emit('mode') }],
  ['插件卸载', f => f.ctx.dispose()],
]

for (const [label, cancel] of cancellations) {
  test(label + ' 暂停已播放音频、清空音源，重复清理不会重复加载', async t => {
    const f = fixture(t)
    const playing = f.execute('play-audio', { asset: 'theme' })
    const audio = f.audios[0]
    audio.request.resolve(); await playing
    cancel(f)
    assertReleased(audio)
    assert.deepEqual(audio.calls.slice(-3), ['pause', 'remove:src', 'load'])
    cancel(f)
    assertReleased(audio)
    assert.equal(f.audios.length, 1)
    if (label === '插件卸载') {
      assert.equal(f.actions.size, 0)
      assert.equal(f.panels.size, 0)
      assert.equal(f.toolbars.size, 0)
      assert.equal(f.observers.size, 0)
    }
  })

  for (const outcome of ['resolve', 'reject']) {
    test(label + ' 中止待播放请求，过期 promise ' + outcome + ' 不重启声音或发通知', async t => {
      const f = fixture(t)
      const pending = f.execute('play-audio', { asset: 'theme' })
      const audio = f.audios[0]
      cancel(f)
      assertReleased(audio)
      const pausesBeforeSettlement = audio.pauseCalls
      assert.deepEqual(f.toasts, [])
      if (outcome === 'resolve') audio.request.resolve()
      else audio.request.reject(Object.assign(Error('播放已中止'), { name: 'AbortError' }))
      await pending
      assertReleased(audio)
      assert.equal(audio.playCalls, 1)
      assert.equal(f.audios.length, 1)
      assert.deepEqual(f.toasts, [], '过期完成不能宣称播放成功或显示取消错误')
      if (outcome === 'resolve') assert.equal(audio.pauseCalls, pausesBeforeSettlement + 1, '旧播放延迟成功后仍须暂停')
    })
  }
}

for (const outcome of ['resolve', 'reject']) {
  test('新音频替换待播放的旧音频，旧 promise ' + outcome + ' 不影响新声音和通知', async t => {
    const f = fixture(t)
    const oldPending = f.execute('play-audio', { asset: 'theme' })
    const oldAudio = f.audios[0]
    const newPending = f.execute('play-audio', { asset: 'effect', loop: false })
    const newAudio = f.audios[1]
    assertReleased(oldAudio)
    assert.equal(newAudio.src, 'https://assets.test/effect.ogg')
    newAudio.request.resolve(); await newPending
    assert.deepEqual(f.toasts, ['正在播放：提示音'])
    if (outcome === 'resolve') oldAudio.request.resolve()
    else oldAudio.request.reject(Object.assign(Error('旧音频播放失败'), { name: 'NotAllowedError' }))
    await oldPending
    assertReleased(oldAudio)
    assert.equal(newAudio.paused, false)
    assert.equal(newAudio.src, 'https://assets.test/effect.ogg')
    assert.equal(newAudio.playCalls, 1)
    assert.equal(newAudio.loadCalls, 0)
    assert.equal(f.audios.length, 2)
    assert.deepEqual(f.toasts, ['正在播放：提示音'])
    f.execute('stop-audio')
    assertReleased(newAudio)
  })
}

for (const name of ['NotAllowedError', 'NotSupportedError']) {
  test('当前 play() 以 ' + name + ' 失败时清理音源，拒绝动作且不发成功通知', async t => {
    const f = fixture(t)
    const pending = f.execute('play-audio', { asset: 'theme' })
    const audio = f.audios[0]
    const rejected = assert.rejects(pending, name === 'NotAllowedError' ? /点击.*播放音乐/ : /无法播放此音频/)
    audio.request.reject(Object.assign(Error('play failed'), { name }))
    await rejected
    assertReleased(audio)
    assert.deepEqual(f.toasts, [])
  })
}
