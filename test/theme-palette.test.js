import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdir } from 'node:fs/promises'
import { normalizeColors, paletteIssues, contrast } from '../applications/notebook/plugins/theme-engine/palette.js'

test('所有主题的正文、辅助文字、强调文字与按钮文字具有可读对比度', async () => {
  for (const name of await readdir(new URL('../applications/notebook/plugins/', import.meta.url))) {
    if (!/^theme(?:-|$)/.test(name) || name === 'theme-engine') continue
    const { default: apply } = await import(`../applications/notebook/plugins/${name}/client.js`)
    let palette
    apply({ themeEngine: { apply(_, preset) { palette = preset.colors } } }, { provide() {} })
    assert.equal(Array.isArray(palette), false, `${name} 使用命名配色`)
    assert.deepEqual(paletteIssues(palette), [], name)
  }
})

test('兼容八色旧主题，指出字段和格式错误，识别按钮白字对比不足', () => {
  const old = ['#211a16', '#2a221c', '#322821', '#f2e8dd', '#b5a493', '#453930', '#d0984f', '#3b2f26']
  const colors = normalizeColors(old)
  assert.ok(contrast(colors.onAccent, colors.accent) >= 4.5)
  assert.deepEqual(paletteIssues(old), [])
  assert.ok(paletteIssues({ ...colors, onAccent: '#ffffff' }).some(issue => issue.foreground === 'onAccent'))
  assert.throws(() => normalizeColors({ ...colors, text: undefined }), /text/)
  assert.throws(() => normalizeColors({ ...colors, onAccent: undefined }), /onAccent/)
  assert.throws(() => normalizeColors({ ...colors, accent: 'invalid' }), /六位/)
  assert.throws(() => normalizeColors(old.slice(1)), /八个/)
})
