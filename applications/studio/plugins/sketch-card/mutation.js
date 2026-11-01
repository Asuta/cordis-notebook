// 每次操作只提交一次原子事务；异步业务只计算 operations，不直接写画板。
export function createMutation(ctx, session) {
  const controller = new AbortController()
  let busy = false
  ctx.effect(() => () => controller.abort())
  return async function mutate(work, { revision } = {}) {
    if (busy) throw Error('操作正在执行，请稍候')
    const boardId = session.boardId
    const check = () => {
      controller.signal.throwIfAborted()
      if (session.stopped || session.held || session.boardId !== boardId) throw Error('画板已切换或正在退出，请重新读取')
    }
    busy = true
    try {
      check()
      await session.flush()
      check()
      if (!session.editable()) throw Error('用户正在编辑，请稍后重试')
      const board = structuredClone(session.board()), expectedRevision = board.revision
      if (revision !== undefined && revision !== expectedRevision) throw Error('画布已变化，请重新 studio_read')
      const operations = await work({ board, signal: controller.signal })
      check()
      if (!session.editable() || session.board().revision !== expectedRevision) throw Error('画布已变化，请重新读取后操作')
      if (!Array.isArray(operations) || !operations.length) throw Error('操作必须返回非空 operations')
      // targetBoard 固定目标；服务端 expectedRevision 拦截排队期间或另一页面的变化。
      const result = await session.edit(operations, { targetBoard: boardId, expectedRevision })
      return { boardId, revision: result.board.revision }
    } finally { busy = false }
  }
}
