const object = (properties, required = []) => ({ type: 'object', properties, required, additionalProperties: false })
const text = { type: 'string' }, revision = { type: 'integer' }
function registerTools(sdk, model) {
  const register = (name, description, schema, callback) => sdk.agent?.register({ name, description, inputSchema: schema }, callback)
  const check = value => { if (!model.editable() || model.read().board.revision !== value) throw Error('用户正在编辑或画布已变化，请重新 studio_read') }
  register('studio_action', '调用 studio_read.actions 列出的扩展操作，传当前 revision。models 搜索全量图片/视频目录（provider、query、kind、type、offset）；model 读取模型真实参数和媒体字段（provider、model）；resume{jobId} 只恢复原任务查询；detach{jobId} 结束本地跟踪，须先核对远端任务。', object({ id: text, revision, args: { type: 'object' } }, ['id', 'revision']), args => model.execute(args.id, { ...args.args, revision: args.revision }, 'agent'))
  register('studio_read', '读取当前灵感画板、revision、卡片类型、连线、图片/视频素材、服务、扩展操作和任务。素材 ID 可作为参考；修改前必须读取。', object({}), model.read)
  register('studio_edit', '像用户一样编辑当前画布。operations：add{node:{id,type,x,y,title,text?,assetId?,prompt?,ratio?,resolution?,provider?,model?,modelParameters?,references?,referenceOrder?,referenceBindings?}}；update{id,patch}；remove{ids}；connect{id,from,to}；disconnect{id}；reorder{id,edges} 调整连线顺序；rename{title}。卡片类型从 studio_read.types 读取。生成卡片 references=[{id,assetId}]；referenceOrder=["direct:参考id","edge:连线id"] 统一排列卡片内与连线素材；modelParameters["服务id:模型id"] 保存该模型参数；referenceBindings[同一键][参考key]=model.mediaFields 中的 path，首尾帧等必须明确分配。先读 model 定义，prompt 用卡片字段。生成新增 image/video 卡片。使用唯一 UUID，保留用户其他内容，自动保存并可撤销。', object({ revision, operations: { type: 'array', minItems: 1, maxItems: 100, items: { type: 'object' } } }, ['revision', 'operations']), async args => { check(args.revision); return model.edit(args.operations, args.revision) })
  register('studio_generate', '明确启动指定生成卡片，使用已连接文字、卡片内及连线图片/视频参考和当前模型参数，立即返回任务 ID；用 studio_jobs 查询。仅用户要求生成时调用。paused 用 resume 查询原任务；uncertain 须核对远端记录，不得直接重新生成以免重复计费。', object({ revision, nodeId: text }, ['revision', 'nodeId']), async args => { check(args.revision); return model.generate(args.nodeId, args.revision) })
  register('studio_jobs', '读取任务状态和图片/视频资产。queued/running 未完成，succeeded 才可报告成功。paused 可恢复原远端 ID 查询；uncertain 表示提交结果未知，先核对远端记录。合理间隔查询，不反复启动生成。', object({}), async () => { await model.refresh(); return { jobs: model.read().jobs, assets: model.read().assets } })
  register('studio_cancel', '暂停 WaveSpeed 本地查询或中断其他服务任务，保留画布、远端 ID 与已有结果。不会保证停止远端生成或退款；有远端 ID 可通过 resume 恢复查询。', object({ id: text }, ['id']), args => model.execute('cancel', { jobId: args.id, revision: model.read().board.revision }, 'agent'))
  register('studio_create_board', '创建并打开新画板。', object({ title: text }, ['title']), async args => { if (!model.editable()) throw Error('请等待用户结束编辑'); return model.newBoard(args.title) })
  register('studio_open_board', '打开已有画板；同一应用内其他画板的生成任务仍保留。', object({ id: text }, ['id']), async args => { if (!model.editable()) throw Error('请等待用户结束编辑'); if (!model.read().boards.some(b => b.id === args.id)) throw Error('画板不存在'); await model.choose(args.id); return model.read() })
  register('studio_inspect_image', '读取图片素材的实际预览，用于理解参考图或检查生成图片。仅支持图片；不能据此声称看过视频，也不能只凭提示词或文件名声称看过图。', object({ assetId: text }, ['assetId']), args => model.api('/inspect/' + encodeURIComponent(args.assetId)))
  register('studio_import_image', '将用户指定的本机 PNG/JPEG/WebP 图片或 MP4/WebM 视频导入素材库，返回素材 id、kind 等元数据；再用 studio_edit add image/video，或加入生成卡片 references。旧素材缺少 kind 时按 image 处理。不读取其他类型文件内容。', object({ path: text }, ['path']), args => model.importImage(args))
}

export default function (ctx, sdk) {
  const s = ctx.canvasSession
  registerTools(sdk, {
    read: s.read, editable: s.editable, refresh: s.refresh, api: s.api, choose: s.choose, newBoard: s.newBoard, importImage: s.importImage, execute: s.execute,
    edit: (operations, revision) => s.edit(operations, { expectedRevision: revision }),
    generate: (nodeId, revision) => s.execute('generate', { nodeId, revision }, 'agent'),
  })
}
