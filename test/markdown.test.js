import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createApp } from '../server/server.js'
import { createMarkdownFormat } from '../applications/notebook/plugins/format-markdown/format.js'
import { createMarkdown } from '../applications/notebook/plugins/markdown/parser.js'
const markdown = createMarkdown(), markdownFormat = createMarkdownFormat(markdown)
const { render: renderMarkdown, toText: markdownText } = markdown

const source = '# 标题\n\n**重点** 和 *斜体*，~~删除~~。\n\n> 引用\n\n- 列表\n- [x] 已完成\n- [ ] 待办\n\n```js\nconst value = 1\n```\n\n| 名称 | 值 |\n| --- | --- |\n| 测试 | 42 |\n\n[链接](https://example.com)\n\n![图片说明](https://example.com/a.png)'
test('Markdown 渲染常用语法，提取纯文本供搜索统计使用', () => {
  const html = renderMarkdown(source), text = markdownText(source)
  for (const expected of ['<h1>标题</h1>', '<strong>重点</strong>', '<em>斜体</em>', '<s>删除</s>', '<blockquote>', '<ul>', '<table>', '<code class="language-js">', 'type="checkbox" disabled checked']) assert.ok(html.includes(expected), expected)
  assert.match(html, /rel="noopener noreferrer"/)
  assert.match(html, /referrerpolicy="no-referrer"/)
  for (const expected of ['标题', '重点', '☑ 已完成', '☐ 待办', 'const value = 1', '测试', '图片说明']) assert.ok(text.includes(expected), expected)
  assert.ok(!text.includes('**')); assert.ok(!text.includes('```')); assert.ok(!text.includes('https://example.com'))
  assert.equal(markdownText(''), '')
  assert.equal(markdownText('普通\n\n段落'), '普通\n段落')
})

test('Markdown 预览不执行原始 HTML，阻止危险链接并正确转义代码', () => {
  const payloads = ['<script>alert(1)</script>', '<img src=x onerror=alert(1)>', '<svg onload=alert(1)>', '[点击](javascript:alert%281%29)', '[点击](jav&#x61;script:alert%281%29)', '![图片](data:text/html;base64,WA==)']
  for (const payload of payloads) {
    const html = renderMarkdown(payload)
    assert.doesNotMatch(html, /<(script|svg|img)\b/i)
    assert.doesNotMatch(html, /(?:href|src)="(?:javascript|data:text\/html):/i)
  }
  assert.match(renderMarkdown('```html\n<img onerror="x">\n```'), /&lt;img/)
  assert.throws(() => markdownFormat.normalize({ markdown: 123 }), /源码/)
  assert.throws(() => markdownFormat.normalize({ markdown: 'x'.repeat(200001) }), /200000/)
})

test('Markdown 插件通过通用 API 保存原始源码，格式停用保留数据，重启恢复', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'cordis-markdown-')), file = join(dir, 'notes.json')
  let app
  try {
    app = await createApp({ port: 0, file })
    const base = () => `http://127.0.0.1:${app.server.address().port}`
    const request = async (path, method, data) => {
      const id = path.slice(1), revision = app.ctx.notes.list().find(n => n.id === id)?.revision ?? 0
      data = ['PATCH', 'DELETE'].includes(method) ? { ...data, revision } : data
      return fetch(base() + '/api/notes' + path, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) })
    }
    const note = await (await request('', 'POST', { type: 'markdown' })).json()
    assert.equal(note.markdown, '')
    const response = await request('/' + note.id, 'PATCH', { title: 'Markdown 验收', markdown: source })
    assert.equal(response.status, 200)
    const saved = await response.json(); assert.equal(saved.markdown, source); assert.equal(saved.content, markdownText(source))
    assert.equal((await request('/' + note.id, 'PATCH', { markdown: {} })).status, 400)
    assert.equal((await request('/' + note.id, 'PATCH', { content: '不能覆盖派生正文' })).status, 400)
    for (const url of ['/builtin/markdown-editor/client.js', '/builtin/markdown-editor/style.css', '/builtin/format-markdown/client.js', '/builtin/markdown/client.js']) assert.equal((await fetch(base() + url)).status, 200)
    await app.manager.toggle('format-markdown', false)
    assert.equal(app.ctx.noteFormats.get('markdown'), undefined)
    assert.equal((await request('/' + note.id, 'PATCH', { title: '被拒绝' })).status, 409)
    assert.equal(app.ctx.notes.list()[0].markdown, source)
    await app.close(); app = await createApp({ port: 0, file })
    assert.equal(app.ctx.notes.list()[0].markdown, source)
    await app.manager.toggle('format-markdown', true)
    assert.equal((await app.ctx.notes.update(note.id, { markdown: '# 恢复编辑' })).content, '恢复编辑')
  } finally { if (app) await app.close(); await rm(dir, { recursive: true, force: true }) }
})
