import { randomUUID } from 'node:crypto'

// Observe the producer rather than consuming its iterator: compaction only calls
// result(), and an extra iterator would steal events from the session. No payload,
// response headers, credentials or model output is retained here.
export function instrumentModelStream(streamFunction, trace, clock = Date.now) {
  return (model, context, options = {}) => {
    const id = randomUUID(), timing = { invokedAt: clock() }
    let finished = false
    const emit = status => trace({ id, kind: 'model', name: '模型请求', status,
      startedAt: timing.invokedAt, ...(finished ? { endedAt: timing.endedAt } : {}), timing: { ...timing } })
    const finish = status => {
      if (finished) return
      finished = true; timing.endedAt = clock(); timing.totalMs = timing.endedAt - timing.invokedAt
      if (timing.firstOutputAt !== undefined) timing.streamingMs = timing.endedAt - timing.firstOutputAt
      emit(status)
    }
    emit('running')
    try {
      const stream = streamFunction(model, context, { ...options,
        onPayload: async (...args) => {
          const result = await options.onPayload?.(...args)
          if (timing.requestStartedAt === undefined) {
            timing.requestStartedAt = clock(); timing.preparationMs = timing.requestStartedAt - timing.invokedAt; emit('running')
          }
          return result
        },
        onResponse: async (...args) => {
          if (timing.responseAt === undefined) {
            timing.responseAt = clock()
            if (timing.requestStartedAt !== undefined) timing.responseWaitMs = timing.responseAt - timing.requestStartedAt
            emit('running')
          }
          return options.onResponse?.(...args)
        },
      })
      const push = stream.push
      stream.push = function (event) {
        if (!finished && timing.firstOutputAt === undefined &&
          ['thinking_delta', 'text_delta', 'toolcall_delta'].includes(event.type) && typeof event.delta === 'string' && event.delta.length) {
          timing.firstOutputAt = clock()
          if (timing.requestStartedAt !== undefined) timing.waitMs = timing.firstOutputAt - timing.requestStartedAt
          emit('running')
        }
        if (event.type === 'done') finish('done')
        if (event.type === 'error') finish(event.reason === 'aborted' || options.signal?.aborted ? 'stopped' : 'error')
        return push.call(this, event)
      }
      return stream
    } catch (error) { finish(options.signal?.aborted ? 'stopped' : 'error'); throw error }
  }
}
