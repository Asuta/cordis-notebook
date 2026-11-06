import { operationError, restoreError } from '../../shared/errors.js'
import { operationResult } from '../../shared/operation-result.js'

/** HTTP and page tools use the same structured error fields; legacy error text remains readable. */
export function createRequest(session, transport = fetch) {
  return async function request(path, method = 'GET', data, signal) {
    const managed = method === 'POST' && /^\/api\/plugins\/[^/]+\/(toggle|config)$/.test(path)
    if (managed) data = { ...data, operationId: data?.operationId ?? crypto.randomUUID() }
    let response, result
    try {
      response = await transport(path, { method, headers: { 'Content-Type': 'application/json', 'X-Application-Session': session }, signal,
        ...(data === undefined ? {} : { body: JSON.stringify(data) }) })
      result = await response.json()
    } catch (error) {
      if (managed) {
        if (!signal?.aborted) {
          // Query before retrying. Only an existing awaiting-client record permits a
          // same-ID replay to recover its preview; the host journal deduplicates it.
          try {
            const headers = { 'Content-Type': 'application/json', 'X-Application-Session': session }
            const observed = await transport('/api/operations/' + data.operationId, { headers, signal })
            if (observed.ok) {
              const operation = await observed.json()
              if (operation.status === 'failed') throw restoreError(operation.error)
              if (['succeeded', 'awaiting-client'].includes(operation.status)) {
                const recovered = operation.status === 'succeeded'
                  ? await transport('/api/plugins', { headers, signal })
                  : await transport(path, { method, headers, signal, body: JSON.stringify(data) })
                const value = await recovered.json()
                if (recovered.ok) return operationResult(value, value.operation || operation)
                throw restoreError({ ...value, message: value.message || value.error, status: recovered.status })
              }
            }
          } catch (cause) { if (cause.operationId === data.operationId && cause.code !== 'OPERATION_RESULT_UNKNOWN') throw cause }
        }
        throw operationError('OPERATION_RESULT_UNKNOWN', '操作结果尚未确认，请查询操作状态后再决定是否重试', { operationId: data.operationId })
      }
      throw error
    }
    if (!response.ok) throw restoreError({ ...result, message: result.message || result.error || '请求失败', status: response.status })
    return managed && result.operation ? operationResult(result, result.operation) : result
  }
}

/** SSE over POST: calls onEvent for each parsed event and returns the final `done` payload. */
export function createStream(session, transport = fetch) {
  return async function stream(path, method = 'POST', data, onEvent, signal) {
    const response = await transport(path, {
      method,
      headers: { 'Content-Type': 'application/json', 'X-Application-Session': session, Accept: 'text/event-stream' },
      body: JSON.stringify(data ?? {}),
      signal,
    })
    if (!response.ok) {
      let result = {}
      try { result = await response.json() } catch {}
      throw restoreError({ ...result, message: result.message || result.error || '请求失败', status: response.status })
    }
    if (!response.body) throw operationError('STREAM_UNAVAILABLE', '当前浏览器不支持流式响应')
    const reader = response.body.getReader(), decoder = new TextDecoder()
    let buffer = '', done = null
    const handle = block => {
      const payload = block.split('\n').filter(line => line.startsWith('data:')).map(line => line.slice(5).trim()).join('\n')
      if (!payload) return
      let event
      try { event = JSON.parse(payload) } catch { return }
      if (event?.type === 'error') throw operationError('STREAM_FAILED', event.message || '生成失败')
      if (event?.type === 'done') done = event
      onEvent?.(event)
    }
    try {
      while (true) {
        const { done: finished, value } = await reader.read()
        if (finished) break
        buffer += decoder.decode(value, { stream: true })
        let index
        while ((index = buffer.indexOf('\n\n')) >= 0) {
          const block = buffer.slice(0, index)
          buffer = buffer.slice(index + 2)
          handle(block)
        }
      }
      if (buffer.trim()) handle(buffer)
    } finally { reader.releaseLock?.() }
    if (!done) throw operationError('STREAM_INCOMPLETE', '流式响应提前结束，请重试')
    return done.session ?? done
  }
}
