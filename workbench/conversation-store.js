import { mkdir, readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { writeSnapshot } from '../shared/persistence.js'

/** @typedef {{id:string, messages:unknown[], turns?:unknown[], [key:string]:unknown}} Conversation */
/** @param {unknown} value @returns {asserts value is Conversation} */
function validate(value) {
  if (!value || typeof value !== 'object' || !('id' in value) || typeof value.id !== 'string' ||
    !/^[a-zA-Z0-9_-]{1,100}$/.test(value.id) || !('messages' in value) || !Array.isArray(value.messages) ||
    ('turns' in value && !Array.isArray(value.turns))) throw Error('会话文件格式无效，原文件已保留')
}
/** @param {string} file @returns {Promise<unknown>} */
async function read(file) { return JSON.parse(await readFile(file, 'utf8')) }

/**
 * One atomic file per conversation. A migration marker is published only after
 * every legacy record is durable. The legacy file remains available for recovery.
 * @param {string} directory
 * @param {{write?: (file:string, data:string)=>Promise<void>, delay?:number, onError?:(error:unknown)=>void}} options
 */
export async function openConversationStore(directory, { write = writeSnapshot, delay = 40, onError = () => {} } = {}) {
  const folder = join(directory, 'conversations'), marker = join(folder, '.format.json')
  await mkdir(folder, { recursive: true })
  let migrated = false
  try { const format = await read(marker); if (!format || typeof format !== 'object' || !('version' in format) || format.version !== 1) throw Error('不支持的会话存储版本'); migrated = true }
  catch (error) { if (/** @type {NodeJS.ErrnoException} */ (error).code !== 'ENOENT') throw error }
  if (!migrated) {
    /** @type {unknown[]} */
    let legacy = []
    try { legacy = /** @type {unknown[]} */ (await read(join(directory, 'conversations.json'))) }
    catch (error) { if (/** @type {NodeJS.ErrnoException} */ (error).code !== 'ENOENT') throw error }
    if (!Array.isArray(legacy)) throw Error('旧会话文件格式无效，原文件已保留')
    const ids = new Set()
    for (const item of legacy) { validate(item); if (ids.has(item.id)) throw Error('旧会话 ID 重复'); ids.add(item.id) }
    for (const [order, thread] of legacy.entries()) {
      validate(thread)
      await write(join(folder, thread.id + '.json'), JSON.stringify({ version: 1, order, thread }))
    }
    await write(marker, JSON.stringify({ version: 1 }))
  }
  /** @type {{order:number, thread:Conversation}[]} */
  const entries = []
  for (const name of await readdir(folder)) {
    if (name === '.format.json' || !name.endsWith('.json')) continue
    const value = /** @type {{version:number, order:number, thread:unknown}} */ (await read(join(folder, name)))
    if (value?.version !== 1 || !Number.isSafeInteger(value.order) || value.order < 0) throw Error('会话索引无效，原文件已保留')
    validate(value.thread)
    if (name !== value.thread.id + '.json') throw Error('会话文件与 ID 不一致')
    entries.push({ order: value.order, thread: value.thread })
  }
  entries.sort((a, b) => a.order - b.order || a.thread.id.localeCompare(b.thread.id))
  const order = new Map(entries.map(entry => [entry.thread.id, entry.order]))
  let nextOrder = Math.max(-1, ...order.values()) + 1
  /** @type {Map<string, Conversation>} */
  const dirty = new Map()
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let timer
  /** @type {Promise<void> | undefined} */
  let writing
  function flush() {
    clearTimeout(timer); timer = undefined
    if (writing) return writing
    writing = (async () => {
      while (dirty.size) {
        const [id, thread] = /** @type {[string, Conversation]} */ (dirty.entries().next().value)
        dirty.delete(id)
        try { await write(join(folder, id + '.json'), JSON.stringify({ version: 1, order: order.get(id), thread })) }
        catch (error) { if (!dirty.has(id)) dirty.set(id, thread); throw error }
      }
    })().finally(() => { writing = undefined })
    return writing
  }
  return {
    conversations: entries.map(entry => entry.thread),
    /** @param {Conversation} thread */
    mark(thread) {
      validate(thread)
      if (!order.has(thread.id)) order.set(thread.id, nextOrder++)
      dirty.set(thread.id, thread)
      if (!timer && !writing) timer = setTimeout(() => { void flush().catch(onError) }, delay)
    },
    flush,
  }
}
