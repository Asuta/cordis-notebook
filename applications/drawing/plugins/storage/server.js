import { Service } from 'cordis'
import { readFile, writeFile, rename } from 'node:fs/promises'
import { join } from 'node:path'

const invalid = message => { throw Object.assign(Error(message), { status: 400 }) }
function validate(input) {
  if (!input || typeof input.title !== 'string' || input.title.length > 120 || !Array.isArray(input.strokes) || input.strokes.length > 3000) invalid('作品标题或笔画数据无效')
  let count = 0
  return { title: input.title, strokes: input.strokes.map(stroke => {
    if (!stroke || !/^#[a-f0-9]{6}$/i.test(stroke.color) || !Number.isFinite(stroke.width) || stroke.width < 1 || stroke.width > 40 || !Array.isArray(stroke.points) || !stroke.points.length) invalid('笔画格式无效')
    count += stroke.points.length; if (count > 30000) invalid('此作品已达到笔画点数上限')
    return { color: stroke.color, width: stroke.width, points: stroke.points.map(point => {
      if (!Array.isArray(point) || point.length !== 2 || point.some(v => !Number.isFinite(v) || v < 0 || v > 1)) invalid('画布坐标无效')
      return [...point]
    }) }
  }) }
}
export default async function (ctx, config, runtime) {
  const file = join(runtime.dataDir, 'drawing.json')
  let value = { title: '我的画作', strokes: [], revision: 0 }, queue = Promise.resolve()
  try {
    const saved = JSON.parse(await readFile(file, 'utf8'))
    if (!Number.isSafeInteger(saved.revision) || saved.revision < 0) invalid('作品版本无效')
    value = { ...validate(saved), revision: saved.revision }
  } catch (error) { if (error.code !== 'ENOENT') throw error }
  Object.assign(new Service(ctx, 'drawingStorage'), {
    read() { return structuredClone(value) },
    save(input) {
      const task = queue.then(async () => {
        if (input?.revision !== value.revision) throw Object.assign(Error('作品已在其他页面更新；本页草稿已保留，请先导出或重新载入'), { status: 409 })
        const next = { ...validate(input), revision: value.revision + 1 }
        await writeFile(file + '.tmp', JSON.stringify(next)); await rename(file + '.tmp', file)
        value = next; return structuredClone(value)
      })
      queue = task.catch(() => {}); return task
    },
  })
  ctx.effect(() => () => queue)
}
