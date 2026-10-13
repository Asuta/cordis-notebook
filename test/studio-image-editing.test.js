import { test } from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { Window } from 'happy-dom'
import { fileURLToPath } from 'node:url'
import { createSession } from '../applications/studio/plugins/canvas/session.js'
import { newBoard } from '../applications/studio/plugins/canvas/store.js'
import { applyOperation } from './helpers/studio-fixture.js'

// Exercise the real dialog callbacks, session refresh/queue, and commit checks.
// Only the React renderer and pixel codec are replaced; no browser or image I/O.
const bundled = await build({
  stdin: { contents: `export { default } from './applications/studio/plugins/image-editing/client.js'; export { roots, imageCalls } from 'editor-test-deps'`, resolveDir: fileURLToPath(new URL('../', import.meta.url)) },
  bundle: true, write: false, format: 'esm', platform: 'node',
  plugins: [{ name: 'editor-test-deps', setup(builder) {
    builder.onResolve({ filter: /^(editor-test-deps|react|react-dom\/client|antd|\.\/upstream\/canvas-(node-(crop|split)-dialog|image-data)\.js)$/ }, () => ({ path: 'deps', namespace: 'test' }))
    builder.onLoad({ filter: /.*/, namespace: 'test' }, () => ({ contents: `
      export const roots = [], imageCalls = [];
      export default { createElement: (type, props, ...children) => ({type, props: {...props, children}}) };
      export function createRoot() { const root = { render(tree) { this.tree = tree }, unmount() {} }; roots.push(root); return root }
      export const ConfigProvider = 'provider', theme = {}, CanvasNodeCropDialog = 'crop', CanvasNodeSplitDialog = 'split';
      export async function cropDataUrl(url) { imageCalls.push(url); return 'data:image/png;base64,aW1hZ2U=' }
      export async function splitDataUrl(url) { return [{row:0,column:0,dataUrl:await cropDataUrl(url)}] }
    ` }))
  } }],
})
const { default: imageEditing, roots, imageCalls } = await import('data:text/javascript;base64,' + Buffer.from(bundled.outputFiles[0].text).toString('base64'))

async function setup(t) {
  roots.length = 0; imageCalls.length = 0
  const window = new Window(), previousWindow = globalThis.window
  globalThis.window = window
  const board = newBoard('图片编辑测试')
  board.revision = 4
  board.nodes = [{ id: 'image', type: 'image', assetId: 'original', title: '原图', x: 0, y: 0 }]
  const remote = { boards: [board], assets: { original: { id: 'original', width: 100, height: 100 }, replacement: { id: 'replacement', width: 200, height: 100 } } }
  const cleanups = [], uploads = [], edits = [], toasts = [], actions = []
  const ctx = { effect(fn) { const release = fn(); cleanups.push(release); return release }, on() {} }
  const sdk = {
    storage: { local: window.localStorage }, toast: message => toasts.push(message), listen() {},
    async request(path, method, body) {
      if (path === '/api/studio') return structuredClone(remote)
      if (path === '/api/studio/upload') {
        uploads.push(body)
        const asset = { id: 'result-' + uploads.length, width: 100, height: 100 }
        remote.assets[asset.id] = asset
        return asset
      }
      if (path === '/api/studio/edit') {
        const index = remote.boards.findIndex(b => b.id === body.boardId)
        if (remote.boards[index].revision !== body.revision) throw Error('画布已变化')
        edits.push(body)
        const inverse = []
        for (const op of body.operations) {
          const result = applyOperation(remote.boards[index], op, remote.assets)
          remote.boards[index] = result.board; inverse.unshift(result.inverse)
        }
        return { board: structuredClone(remote.boards[index]), inverse }
      }
      throw Error('未处理请求：' + path)
    },
  }
  t.after(async () => { for (const cleanup of cleanups.reverse()) await cleanup?.(); await window.happyDOM.close(); globalThis.window = previousWindow })
  const s = ctx.canvasSession = await createSession(ctx, sdk)
  ctx.canvasUI = {
    root: window.document.createElement('div'),
    el(tag, props = {}, text) { const node = window.document.createElement(tag); if (text) node.textContent = text; return node },
    render() {}, select() {}, focus() {}, bounds: () => ({ width: 100, height: 100 }),
    actions(owner, type, items) { actions.push(...items) },
  }
  imageEditing(ctx, sdk)
  const open = (mode, node = s.board().nodes[0]) => {
    actions.find(a => a.label === (mode === 'crop' ? '裁剪图片' : '切分图片')).run(structuredClone(node))
    return roots[0].tree.props.children[0].props
  }
  const confirm = (dialog, mode) => dialog.onConfirm(mode === 'crop' ? { x: 0, y: 0, width: 1, height: 1 } : { rows: 1, columns: 1 })
  return { s, remote, uploads, edits, toasts, open, confirm }
}

for (const mode of ['crop', 'split']) {
  for (const change of ['asset', 'revision', 'board']) test(`${mode} 弹窗确认拒绝已变化的 ${change}，不处理或上传错误图片`, async t => {
    const { s, remote, uploads, toasts, open, confirm } = await setup(t)
    const dialog = open(mode)
    assert.equal(dialog.dataUrl, '/api/studio/images/original.png')
    if (change === 'board') {
      const other = { ...structuredClone(remote.boards[0]), id: 'other-board' }
      remote.boards.push(other)
      await s.refresh(); await s.choose(other.id)
    } else {
      if (change === 'asset') remote.boards[0].nodes[0].assetId = 'replacement'
      remote.boards[0].revision++
      await s.refresh()
    }
    await confirm(dialog, mode)
    assert.match(toasts[0], /画布或原图已变化/)
    assert.deepEqual(imageCalls, [])
    assert.deepEqual(uploads, [])
    assert.ok(roots[0].tree, '冲突后保留弹窗，不谎报完成')
  })

  test(`${mode} 源图未变化时处理预览原图并以捕获版本提交`, async t => {
    const { remote, uploads, edits, toasts, open, confirm } = await setup(t)
    await confirm(open(mode), mode)
    assert.deepEqual(toasts, [])
    assert.deepEqual(imageCalls, ['/api/studio/images/original.png'])
    assert.equal(uploads.length, 1)
    assert.equal(edits[0].revision, 4)
    assert.equal(remote.boards[0].nodes[1].sourceNodeId, 'image')
    assert.equal(roots[0].tree, null)
  })

  test(`${mode} 冲突后从旧工具栏重新打开时预览和处理最新源图`, async t => {
    const { s, remote, toasts, open, confirm } = await setup(t)
    const staleNode = structuredClone(s.board().nodes[0]), dialog = open(mode, staleNode)
    remote.boards[0].nodes[0].assetId = 'replacement'
    remote.boards[0].revision++
    await s.refresh()
    await confirm(dialog, mode)
    assert.match(toasts.pop(), /画布或原图已变化/)
    dialog.onClose()
    const reopened = open(mode, staleNode)
    assert.equal(reopened.dataUrl, '/api/studio/images/replacement.png')
    await confirm(reopened, mode)
    assert.deepEqual(toasts, [])
    assert.deepEqual(imageCalls, ['/api/studio/images/replacement.png'])
  })
}
