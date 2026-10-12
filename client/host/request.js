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
