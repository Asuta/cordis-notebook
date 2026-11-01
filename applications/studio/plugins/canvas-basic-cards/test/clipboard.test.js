import { test } from 'node:test'
import assert from 'node:assert/strict'
import { clipboardImages, dataUrlFile } from '../clipboard.js'

const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3])
const pngBase64 = Buffer.from(png).toString('base64')
const file = (name, type, bytes = png) => new File([bytes], name, { type })
const clipboard = overrides => ({ files: [], items: [], getData: () => '', ...overrides })

test('优先读取图片文件并跳过非图片', () => {
  const image = file('screen.png', 'image/png'), document = file('note.pdf', 'application/pdf')
  assert.deepEqual(clipboardImages(clipboard({ files: [document, image] })), [image])
})

test('files 与 items 中的同一图片只保留一次', () => {
  const image = file('screen.png', 'image/png')
  const files = clipboardImages(clipboard({ files: [image], items: [{ kind: 'file', getAsFile: () => image }] }))
  assert.equal(files.length, 1)
  assert.equal(files[0], image)
})

test('同名同大小但内容不同的图片文件都保留', async () => {
  const first = file('image.png', 'image/png', new Uint8Array([1, 2, 3]))
  const second = file('image.png', 'image/png', new Uint8Array([4, 5, 6]))
  const files = clipboardImages(clipboard({ files: [first, second], items: [{ kind: 'file', getAsFile: () => assert.fail('已有图片文件时不应重复读取 items') }] }))
  assert.deepEqual(files, [first, second])
  assert.notDeepEqual(await files[0].arrayBuffer(), await files[1].arrayBuffer())
})

test('files 无可用图片时回退 items，并保留同名同大小的独立图片', () => {
  const images = [file('image.png', 'image/png', new Uint8Array([1, 2])), file('image.png', 'image/png', new Uint8Array([3, 4]))]
  const data = clipboard({ files: [file('note.pdf', 'application/pdf')], items: images.map(image => ({ kind: 'file', getAsFile: () => image })) })
  assert.deepEqual(clipboardImages(data), images)
})

test('HTML 中只有 data URL 图片时还原为文件', () => {
  const html = `<p><img src="data:image/png;base64,${pngBase64}" width="10"><img src="https://example.com/a.png"></p><img src="data:image/png;base64,${pngBase64}">`
  const parser = class { parseFromString() { return { querySelectorAll: () => [...html.matchAll(/<img src="([^"]+)"/g)].map(match => ({ getAttribute: () => match[1] })) } } }
  const previous = globalThis.DOMParser
  globalThis.DOMParser = parser
  try {
    const files = clipboardImages(clipboard({ getData: type => type === 'text/html' ? html : '' }))
    assert.equal(files.length, 1)
    assert.equal(files[0].type, 'image/png')
    assert.equal(files[0].size, png.length)
  } finally { if (previous) globalThis.DOMParser = previous; else delete globalThis.DOMParser }
})

test('纯文本 data URL 也能粘贴', () => {
  const dataUrl = `data:image/jpeg;base64,${Buffer.from([255, 216, 255]).toString('base64')}`
  const files = clipboardImages(clipboard({ getData: type => type === 'text/plain' ? dataUrl : '' }))
  assert.equal(files.length, 1)
  assert.equal(files[0].type, 'image/jpeg')
  assert.equal(files[0].name, '粘贴的图片.jpg')
})

test('非图片内容返回空数组，非法 data URL 被忽略', () => {
  assert.deepEqual(clipboardImages(clipboard({ files: [file('a.pdf', 'application/pdf')], getData: type => type === 'text/plain' ? 'hello' : '' })), [])
  assert.deepEqual(clipboardImages(clipboard({ getData: type => type === 'text/plain' ? 'data:image/png;base64,@@@' : '' })), [])
  assert.deepEqual(clipboardImages(null), [])
  assert.equal(dataUrlFile('data:image/svg+xml;base64,PHN2Zz4='), null)
})
