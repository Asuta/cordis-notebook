/** @typedef {{code:string, message:string, status:number, retryable:boolean, operationId?:string}} ErrorDetail */
/** @param {unknown} error @returns {ErrorDetail} */
export function errorDetail(error) {
  const value = /** @type {Partial<ErrorDetail>} */ (error && typeof error === 'object' ? error : {})
  const status = typeof value.status === 'number' && Number.isInteger(value.status) && value.status >= 400 && value.status <= 599 ? value.status : 500
  const defaults = /** @type {Record<number,string>} */ ({ 400: 'INVALID_ARGUMENT', 404: 'NOT_FOUND', 409: 'STATE_CONFLICT' })
  return { code: typeof value.code === 'string' ? value.code : (defaults[status] || 'OPERATION_FAILED'),
    message: typeof value.message === 'string' ? value.message : String(error), status, retryable: value.retryable === true,
    ...(typeof value.operationId === 'string' ? { operationId: value.operationId } : {}) }
}
/** @param {string} code @param {string} message @param {{status?:number,retryable?:boolean,operationId?:string}} options */
export function operationError(code, message, options = {}) {
  return Object.assign(Error(message), { code, status: 500, retryable: false, ...options })
}
/** Accept both the structured protocol and legacy text errors. @param {unknown} detail */
export function restoreError(detail) {
  const value = errorDetail(typeof detail === 'string' ? Error(detail) : detail)
  return Object.assign(Error(value.message), value)
}
