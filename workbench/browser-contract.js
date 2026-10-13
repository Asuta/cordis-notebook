import { Type } from '@sinclair/typebox'
import { Value } from '@sinclair/typebox/value'

const object = properties => Type.Object(properties, { additionalProperties: false })
const text = (maxLength = 2000) => Type.String({ minLength: 1, maxLength })
const target = Type.Union([
  object({ role: text(100), name: Type.Optional(text()) }),
  ...['label', 'text', 'css', 'testId'].map(key => object({ [key]: text() })),
], { description: '从页面结构或 targets 选择一种唯一定位方式：role/name、label、text、css 或 testId。' })
const label = Type.Optional(text(200))
const timeoutMs = Type.Optional(Type.Integer({ minimum: 0, maximum: 10000, description: '断言等待目标状态的上限，默认 5000ms；0 表示立即检查。' }))
const variants = [
  ...['snapshot', 'screenshot', 'reload'].map(action => object({ action: Type.Literal(action) })),
  object({ action: Type.Literal('scroll'), direction: Type.Union([Type.Literal('up'), Type.Literal('down')]) }),
  ...['click', 'inspect'].map(action => object({ action: Type.Literal(action), target })),
  ...['fill', 'press', 'select'].map(action => object({ action: Type.Literal(action), target,
    value: Type.String({ minLength: action === 'press' ? 1 : 0, maxLength: 20000 }) })),
  object({ action: Type.Literal('check'), target, checked: Type.Boolean() }),
  object({ action: Type.Literal('assert'), target, assertion: Type.Optional(Type.Literal('text')),
    expected: text(), label, timeoutMs }),
  ...['value', 'placeholder'].map(assertion => object({ action: Type.Literal('assert'), target,
    assertion: Type.Literal(assertion), expected: Type.String({ maxLength: 2000 }), label, timeoutMs })),
  object({ action: Type.Literal('assert'), target, assertion: Type.Literal('visible'), expected: Type.Boolean(), label, timeoutMs }),
]
export const browserSchemas = {
  browser_report: object({}),
  browser_plugin: object({ id: Type.String({ pattern: '^[a-z][a-z0-9-]{1,49}$' }), enable: Type.Optional(Type.Literal(true)) }),
  browser_open: object({ width: Type.Optional(Type.Integer({ minimum: 320, maximum: 1920 })),
    height: Type.Optional(Type.Integer({ minimum: 300, maximum: 1440 })) }),
  browser_retest: object({ reason: text(), width: Type.Optional(Type.Integer({ minimum: 320, maximum: 1920 })),
    height: Type.Optional(Type.Integer({ minimum: 300, maximum: 1440 })) }),
  browser_batch: object({ steps: Type.Array(Type.Union(variants), { minItems: 1, maxItems: 12 }) }),
  browser_scenario: object({ id: Type.String({ pattern: '^[a-z][a-z0-9-]{1,59}$' }), parameters: Type.Optional(Type.Record(Type.String(), Type.String({ maxLength: 2000 }))) }),
  // Keep an object at the root for model providers, with required fields per operation.
  browser_action: Type.Intersect([
    Type.Object({ action: Type.Union([...new Set(variants.map(item => item.properties.action.const))].map(Type.Literal)) }),
    Type.Union(variants),
  ], { type: 'object' }),
  browser_finish: object({ result: Type.Union(['passed', 'failed', 'incomplete'].map(Type.Literal)), summary: text() }),
}
export function usageError(message) {
  return Object.assign(Error('调用参数错误（可修正）：' + message), { kind: 'usage' })
}
export function validateBrowserInput(name, args) {
  let schema = browserSchemas[name]
  if (!schema) throw usageError('未知浏览器工具')
  if (name === 'browser_action') {
    schema = variants.find(item => item.properties.action.const === args?.action &&
      (args.action !== 'assert' || item.properties.assertion.const === (args.assertion ?? 'text')))
    if (!schema) throw usageError('未知 action 或 assertion；断言类型为 text、value、placeholder、visible')
  }
  if (!Value.Check(schema, args)) {
    const errors = [...Value.Errors(schema, args)].slice(0, 3).map(error => `${error.path || '/'}: ${error.message}`)
    throw usageError(errors.join('；'))
  }
  if (name === 'browser_finish' && !args.summary.trim()) throw usageError('summary 需要说明实际检查范围')
  if (name === 'browser_retest' && !args.reason.trim()) throw usageError('reason 需要说明修复内容与复测原因')
  if (name === 'browser_batch') for (const [index, step] of args.steps.entries()) {
    try { validateBrowserInput('browser_action', step) }
    catch (error) { throw usageError('steps/' + index + '：' + error.message) }
  }
  if (name === 'browser_action' && args.action === 'assert' && (args.assertion ?? 'text') === 'text' && !args.expected.trim()) {
    throw usageError('text 断言需要非空 expected；空输入框请用 value')
  }
}
