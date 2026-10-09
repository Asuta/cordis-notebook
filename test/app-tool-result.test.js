import { test } from 'node:test'
import assert from 'node:assert/strict'
import { appToolResult } from '../workbench/app-tool-result.js'
test('应用图片预览作为图像发送，普通应用结果保持 JSON；拒绝越界图片', () => {
  assert.equal(appToolResult({ title: '笔记' }).content[0].text, '{"title":"笔记"}')
  const result = appToolResult({ asset: { id: 'a' }, image: { type: 'image', mimeType: 'image/webp', data: 'eA==' } })
  assert.equal(result.content[1].type, 'image'); assert.doesNotMatch(result.content[0].text, /eA==/)
  assert.throws(() => appToolResult({ image: { type: 'image', mimeType: 'text/html', data: 'eA==' } }), /无效/)
  assert.throws(() => appToolResult({ image: { type: 'image', mimeType: 'image/png', data: 'A'.repeat(3 * 1024 * 1024) } }), /无效/)
})
