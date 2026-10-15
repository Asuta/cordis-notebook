import { noteType, snapshotNote } from './note.js'
import { normalizeProperties } from './properties.js'

const fail = (status, message) => Object.assign(new Error(message), { status })
const reserved = new Set(['id', 'type', 'title', 'pinned', 'parentId', 'properties', 'template', 'order', 'createdAt', 'updatedAt', 'revision', '__proto__', 'constructor', 'prototype'])
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
      return [...new Set([...(format?.references?.(snapshotNote(note)) || []), ...(note.template?.databaseId ? [note.template.databaseId] : [])])]
    },
    remapReferences(note, ids) {
      const format = requireFormat(noteType(note))
      const data = format.remapReferences?.(snapshotNote(note), Object.freeze({ ...ids }))
      const result = data ? { ...note, ...normalize(format, data) } : structuredClone(note)
      if (result.template?.databaseId && Object.hasOwn(ids, result.template.databaseId)) result.template = { databaseId: ids[result.template.databaseId] }
      return result
    },
    validateCollection(notes, previous = []) {
      const children = new Map(), byId = new Map(notes.map(note => [note.id, note])), before = new Map(previous.map(note => [note.id, note]))
      for (const note of notes) {
        if (note.template && note.parentId != null) throw fail(400, '模板必须独立存放，不能作为数据库记录或子页面')
        const templateDatabase = byId.get(note.template?.databaseId)
        if (templateDatabase && (templateDatabase.type !== 'database' || templateDatabase.template)) throw fail(400, '模板范围必须是实际数据库')
        const parentId = note.parentId ?? note.template?.databaseId
        const parent = byId.get(parentId), old = before.get(note.id)
        if (parent && !formats.has(noteType(parent)) && note.properties?.custom
          && (JSON.stringify(old?.properties?.custom) !== JSON.stringify(note.properties.custom) || (old?.parentId ?? old?.template?.databaseId) !== parentId)) throw fail(409, '请先启用父页面的格式插件，再修改自定义属性')
        if (parentId) { if (!children.has(parentId)) children.set(parentId, []); children.get(parentId).push(note) }
      }
      for (const note of notes) {
        if (note.template && children.has(note.id)) throw fail(400, '模板不能拥有子页面')
        const validate = formats.get(noteType(note))?.validateChildren
        // A schema checks record metadata, not entire child documents. Avoid
        // cloning all BlockNote bodies on each keystroke in a database record.
        if (validate) { try { validate(snapshotNote(note), snapshotNote((children.get(note.id) || []).map(({ id, title, type, parentId, properties, template }) => ({ id, title, type, parentId, properties, template })))) } catch (error) { throw fail(400, error.message) } }
      }
    },
    observe(owner, handler) { return owner.effect(() => { listeners.add(handler); handler(); return () => listeners.delete(handler) }) },
    register(owner, definition) {
      if (!definition || !/^[a-z][a-z0-9-]{0,49}$/.test(definition.type) || typeof definition.label !== 'string' || !definition.label || typeof definition.editor !== 'string') throw new Error('格式声明需要合法的 type、label 和 editor')
      if (!Array.isArray(definition.fields) || new Set(definition.fields).size !== definition.fields.length || definition.fields.some(key => typeof key !== 'string' || !/^[a-zA-Z][\w]*$/.test(key) || reserved.has(key))) throw new Error('格式数据字段无效或占用公共字段')
      for (const key of ['defaults', 'normalize', 'toText']) if (typeof definition[key] !== 'function') throw new Error('格式声明缺少 ' + key)
      for (const key of ['references', 'remapReferences', 'validateChildren']) if (definition[key] !== undefined && typeof definition[key] !== 'function') throw new Error('格式声明的 ' + key + ' 必须为函数')
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
      const allowed = new Set(['title', 'pinned', 'parentId', 'properties', 'template', 'content', 'type', ...format.fields])
      if (Object.keys(patch).some(key => !allowed.has(key))) throw fail(400, '笔记包含此格式不支持的字段')
      if ('title' in patch && (typeof patch.title !== 'string' || patch.title.length > 200)) throw fail(400, '笔记标题过长或格式错误')
      if ('pinned' in patch && typeof patch.pinned !== 'boolean') throw fail(400, '置顶格式错误')
      if ('parentId' in patch && patch.parentId !== null && (typeof patch.parentId !== 'string' || !/^[\w:-]{1,100}$/.test(patch.parentId))) throw fail(400, '父页面 ID 无效')
      const data = payload(format, { ...note, ...patch }), result = normalize(format, data)
      if ('properties' in patch) { try { result.properties = normalizeProperties(patch.properties, note.properties) } catch (error) { throw fail(400, error.message) } }
      if ('template' in patch) {
        const value = patch.template
        if (value !== null && (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => key !== 'databaseId') || value.databaseId !== null && (typeof value.databaseId !== 'string' || !/^[\w:-]{1,100}$/.test(value.databaseId)))) throw fail(400, '模板范围无效')
        result.template = value === null ? null : { databaseId: value.databaseId }
      }
      if ('content' in patch && !format.fields.includes('content') && patch.content !== result.content) throw fail(400, '派生正文必须与格式数据一致')
      return { ...note, ...result, ...('title' in patch ? { title: patch.title } : {}), ...('pinned' in patch ? { pinned: patch.pinned } : {}), ...('parentId' in patch ? { parentId: patch.parentId } : {}) }
    },
    patch(note) {
      const format = requireFormat(noteType(note))
      return structuredClone({ title: note.title, pinned: note.pinned, ...(note.parentId !== undefined ? { parentId: note.parentId } : {}), ...(note.properties !== undefined ? { properties: note.properties } : {}), ...(note.template !== undefined ? { template: note.template } : {}), ...payload(format, note) })
    },
  }
}
