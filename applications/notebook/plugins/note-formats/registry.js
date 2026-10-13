import { noteType, snapshotNote } from './note.js'

const fail = (status, message) => Object.assign(new Error(message), { status })
const reserved = new Set(['id', 'type', 'title', 'pinned', 'parentId', 'order', 'createdAt', 'updatedAt', 'revision', '__proto__', 'constructor', 'prototype'])
// Both processes use the same contract, but each owns its registrations independently.
export function createFormatRegistry(ctx) {
  const formats = new Map(), listeners = new Set()
  const notify = () => { for (const handler of [...listeners]) { try { handler() } catch (error) { ctx.logger.error(error) } } }
  ctx.effect(() => () => { formats.clear(); listeners.clear() })
  const requireFormat = type => {
    const format = formats.get(type)
    if (!format) throw fail(409, `笔记格式“${type}”不可用，请启用对应格式插件`)
    return format
  }
  const normalize = (format, data) => {
    try {
      const value = format.normalize(snapshotNote(data))
      if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !format.fields.includes(key))) throw new Error('格式插件返回了未声明的数据字段')
      const content = format.toText(snapshotNote(value))
      if (typeof content !== 'string' || content.length > 200000) throw new Error('笔记正文无效或超过 200000 字符')
      return { ...structuredClone(value), content }
    } catch (error) { throw fail(400, error.message) }
  }
  const payload = (format, note) => Object.fromEntries(format.fields.map(key => [key, note[key]]))
  return {
    typeOf: noteType,
    snapshot: snapshotNote,
    get: type => formats.get(type),
    list: () => [...formats.values()],
    references(note) {
      const format = formats.get(noteType(note))
      return [...new Set(format?.references?.(snapshotNote(note)) || [])]
    },
    remapReferences(note, ids) {
      const format = requireFormat(noteType(note))
      const data = format.remapReferences?.(snapshotNote(note), Object.freeze({ ...ids }))
      return data ? { ...note, ...normalize(format, data) } : structuredClone(note)
    },
    observe(owner, handler) { return owner.effect(() => { listeners.add(handler); handler(); return () => listeners.delete(handler) }) },
    register(owner, definition) {
      if (!definition || !/^[a-z][a-z0-9-]{0,49}$/.test(definition.type) || typeof definition.label !== 'string' || !definition.label || typeof definition.editor !== 'string') throw new Error('格式声明需要合法的 type、label 和 editor')
      if (!Array.isArray(definition.fields) || new Set(definition.fields).size !== definition.fields.length || definition.fields.some(key => typeof key !== 'string' || !/^[a-zA-Z][\w]*$/.test(key) || reserved.has(key))) throw new Error('格式数据字段无效或占用公共字段')
      for (const key of ['defaults', 'normalize', 'toText']) if (typeof definition[key] !== 'function') throw new Error('格式声明缺少 ' + key)
      for (const key of ['references', 'remapReferences']) if (definition[key] !== undefined && typeof definition[key] !== 'function') throw new Error('格式声明的 ' + key + ' 必须为函数')
      if (formats.has(definition.type)) throw new Error('笔记格式重复注册：' + definition.type)
      const format = Object.freeze({ ...definition, fields: Object.freeze([...definition.fields]) })
      normalize(format, format.defaults())
      return owner.effect(() => {
        formats.set(format.type, format); notify()
        return () => { if (formats.get(format.type) === format) { formats.delete(format.type); notify() } }
      })
    },
    create(type = 'plain') {
      const format = requireFormat(type)
      return { type, title: '', pinned: false, ...normalize(format, format.defaults()) }
    },
    update(note, patch) {
      if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw fail(400, '笔记格式错误')
      const format = requireFormat(noteType(note))
      if ('type' in patch && patch.type !== noteType(note)) throw fail(400, '暂不支持转换笔记格式')
      const allowed = new Set(['title', 'pinned', 'parentId', 'content', 'type', ...format.fields])
      if (Object.keys(patch).some(key => !allowed.has(key))) throw fail(400, '笔记包含此格式不支持的字段')
      if ('title' in patch && (typeof patch.title !== 'string' || patch.title.length > 200)) throw fail(400, '笔记标题过长或格式错误')
      if ('pinned' in patch && typeof patch.pinned !== 'boolean') throw fail(400, '置顶格式错误')
      if ('parentId' in patch && patch.parentId !== null && (typeof patch.parentId !== 'string' || !/^[\w:-]{1,100}$/.test(patch.parentId))) throw fail(400, '父页面 ID 无效')
      const data = payload(format, { ...note, ...patch }), result = normalize(format, data)
      if ('content' in patch && !format.fields.includes('content') && patch.content !== result.content) throw fail(400, '派生正文必须与格式数据一致')
      return { ...note, ...result, ...('title' in patch ? { title: patch.title } : {}), ...('pinned' in patch ? { pinned: patch.pinned } : {}), ...('parentId' in patch ? { parentId: patch.parentId } : {}) }
    },
    patch(note) {
      const format = requireFormat(noteType(note))
      return structuredClone({ title: note.title, pinned: note.pinned, ...(note.parentId !== undefined ? { parentId: note.parentId } : {}), ...payload(format, note) })
    },
  }
}
