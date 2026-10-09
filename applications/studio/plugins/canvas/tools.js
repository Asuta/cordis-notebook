const object = (properties, required = []) => ({ type: 'object', properties, required, additionalProperties: false })
const text = { type: 'string' }, revision = { type: 'integer' }
export function registerTools(sdk, model) {
  const register = (name, description, schema, callback) => sdk.agent?.register({ name, description, inputSchema: schema }, callback)
  const check = value => { if (!model.editable() || model.read().board.revision !== value) throw Error('用户正在编辑或画布已变化，请重新 studio_read') }
  register('studio_read', '读取当前灵感画板、revision、卡片、连线、素材和任务。图片资产 ID 可作为参考；修改前必须读取。', object({}), model.read)
  register('studio_edit', '像用户一样编辑当前画布。operations 是原子操作数组：add{node:{id,type:text|image|generator,x,y,title,text?,assetId?,prompt?,ratio?,resolution?}}；update{id,patch}；remove{ids}；connect{id,from,to}；disconnect{id}；reorder{id:生成卡片ID,edges:有序连线ID}；rename{title}。id 使用唯一 UUID。只允许文字/图片连到 generator；每次生成会增加新的 image 卡片。保留用户未要求修改的内容，自动保存并可撤销。', object({ revision, operations: { type: 'array', minItems: 1, maxItems: 100, items: { type: 'object' } } }, ['revision', 'operations']), async args => { check(args.revision); return model.edit(args.operations, args.revision) })
  register('studio_generate', '明确启动指定生成卡片，使用已连接文字/参考图和该卡片参数。调用立即返回任务 ID，不等待图片完成；用 studio_jobs 查询。仅在用户要求生成时调用，不因编辑/连线自动生成。重试前先查询，避免重复请求。', object({ revision, nodeId: text }, ['revision', 'nodeId']), async args => { check(args.revision); return model.generate(args.nodeId, args.revision) })
  register('studio_jobs', '读取生成任务状态和图片资产。queued/running 表示未完成，succeeded 才可报告成功。间隔合理查询，不反复启动同一任务。', object({}), async () => { await model.refresh(); return { jobs: model.read().jobs, assets: model.read().assets } })
  register('studio_cancel', '中断指定任务，保留画布与已有结果；上游已开始的请求不保证退款。', object({ id: text }, ['id']), async args => { const result = await model.api('/cancel', args); await model.refresh(); return result })
  register('studio_create_board', '创建并打开新画板。', object({ title: text }, ['title']), async args => { if (!model.editable()) throw Error('请等待用户结束编辑'); return model.newBoard(args.title) })
  register('studio_open_board', '打开已有画板；同一应用内其他画板的生成任务仍保留。', object({ id: text }, ['id']), async args => { if (!model.editable()) throw Error('请等待用户结束编辑'); if (!model.read().boards.some(b => b.id === args.id)) throw Error('画板不存在'); await model.choose(args.id); return model.read() })
  register('studio_inspect_image', '读取画板素材的实际预览图片，用于理解参考图或检查生成结果。只凭提示词和文件名不能声称看过图。', object({ assetId: text }, ['assetId']), args => model.api('/inspect/' + encodeURIComponent(args.assetId)))
  register('studio_import_image', '将用户指定的本机图片文件导入素材库，返回 assetId；再用 studio_edit add image 加入画布。只支持图片，不读取其他文件内容。', object({ path: text }, ['path']), args => model.importImage(args))
}
