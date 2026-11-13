import { readFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { validateProject } from './model.js'
import { templateProject } from './demo.js'

const fail = (status,message) => { throw Object.assign(Error(message),{status}) }
async function body(req) {
  const chunks = []; let size = 0
  for await (const chunk of req) { size += chunk.length; if (size > 25 * 1024 * 1024) fail(413,'作品请求不能超过 25 MB'); chunks.push(chunk) }
  try { return JSON.parse(Buffer.concat(chunks).toString() || '{}') } catch { fail(400,'作品 JSON 格式无效') }
}
export default async function(ctx,config,runtime) {
  const dir = join(runtime.dataDir,'projects'); await mkdir(dir,{recursive:true})
  const indexFile = join(runtime.dataDir,'index.json')
  let index, queue = Promise.resolve()
  const enqueue = fn => { const task = queue.then(fn); queue = task.catch(()=>{}); return task }
  const summary = p => ({id:p.id,title:p.title,description:p.description,template:p.template,revision:p.revision,nodes:p.nodes.length,characters:p.characters.length,updatedAt:new Date().toISOString()})
  const writeIndex = () => runtime.writeSnapshot(indexFile,JSON.stringify(index))
  const file = id => join(dir,id + '.json')
  async function read(id) {
    if (!index.some(p => p.id === id)) fail(404,'作品不存在')
    return validateProject(JSON.parse(await readFile(file(id),'utf8')))
  }
  async function write(p) { validateProject(p); await runtime.writeSnapshot(file(p.id),JSON.stringify(p)); index = [summary(p),...index.filter(row=>row.id!==p.id)]; await writeIndex(); return structuredClone(p) }
  try { index = JSON.parse(await readFile(indexFile,'utf8')); if (!Array.isArray(index) || index.some(p => !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/.test(p.id))) throw Error('作品索引损坏') }
  catch(error) { if (error.code !== 'ENOENT') throw error; index = []; await write(templateProject('hybrid',undefined,'starlight-observatory')) }
  const route = (method,path,fn) => ctx.http.route(ctx,method,path,fn)
  route('GET',/^\/api\/narrative\/projects$/,()=>structuredClone(index))
  route('POST',/^\/api\/narrative\/projects$/,async({req})=> {
    const input = await body(req)
    return enqueue(async()=> {
      if (index.length >= 50) fail(400,'最多保存 50 部作品')
      if (!['hybrid','galgame','tavern'].includes(input.template)) fail(400,'请选择作品模板')
      if (input.title !== undefined && (typeof input.title !== 'string' || !input.title.trim() || input.title.length > 120)) fail(400,'作品名称无效')
      return write(templateProject(input.template,input.title?.trim()))
    })
  })
  route('POST',/^\/api\/narrative\/import$/,async({req})=> {
    const input = validateProject(await body(req))
    return enqueue(async()=> { if (index.length >= 50) fail(400,'最多保存 50 部作品'); return write({...input,id:randomUUID(),revision:0}) })
  })
  route('GET',/^\/api\/narrative\/projects\/([a-zA-Z0-9_-]{1,80})$/,({match})=>read(match[1]))
  route('PUT',/^\/api\/narrative\/projects\/([a-zA-Z0-9_-]{1,80})$/,async({req,match})=> {
    const next = validateProject(await body(req))
    return enqueue(async()=> {
      const current = await read(match[1])
      if (next.id !== current.id || next.revision !== current.revision) fail(409,'作品已在其他页面更新；草稿已保留，请导出草稿或重新载入')
      return write({...next,revision:current.revision+1})
    })
  })
  ctx.effect(()=>()=>queue)
}
