import { setTimeout as delay } from 'node:timers/promises'
import { usageError } from './browser-contract.js'

// Poll the condition, not just visibility. Transient samples are not assertions;
// exactly one final result (including genuine timeouts) becomes report evidence.
export async function assertTarget(input, target, checks) {
  const assertion = input.assertion || 'text', startedAt = Date.now(), timeoutMs = input.timeoutMs ?? 5000
  const check = { assertion, target: input.target, label: input.label || `${assertion}: ${input.expected}`,
    expected: input.expected, timeoutMs, passed: false }
  let usage = false
  try {
    do {
      const sample = await target.evaluateAll((elements, kind) => {
        if (elements.length !== 1) return { count: elements.length, visible: false,
          candidates: elements.slice(0, 6).map(element => ({ tag: element.tagName.toLowerCase(),
            testId: element.getAttribute('data-testid'), label: element.getAttribute('aria-label'), text: (element.innerText || '').slice(0, 160) })) }
        const element = elements[0], style = getComputedStyle(element)
        const rect = element.getBoundingClientRect()
        const visible = style.visibility !== 'hidden' && style.visibility !== 'collapse' && !!(rect.width && rect.height)
        const supported = kind === 'value' ? /^(INPUT|TEXTAREA|SELECT)$/.test(element.tagName)
          : kind === 'placeholder' ? /^(INPUT|TEXTAREA)$/.test(element.tagName) : true
        return { count: 1, visible, supported, actual: kind === 'visible' ? visible : kind === 'value' ? element.value
          : kind === 'placeholder' ? element.getAttribute('placeholder') : element.innerText || '' }
      }, assertion)
      check.matchCount = sample.count
      if (sample.count > 1) throw Object.assign(Error(`定位需要唯一元素，实际匹配 ${sample.count} 个`), {
        diagnostics: { target: input.target, matchCount: sample.count, candidates: sample.candidates } })
      if (sample.supported === false) {
        usage = true
        throw usageError(`${assertion} 断言需要对应的输入控件；普通文字请用 text`)
      }
      const actual = assertion === 'visible' ? sample.visible : sample.actual
      check.actual = typeof actual === 'string' ? actual.slice(0, 3000) : actual ?? null
      check.passed = assertion === 'visible' ? actual === input.expected
        : sample.count === 1 && sample.visible && (assertion === 'text' ? actual.includes(input.expected) : actual === input.expected)
      if (check.passed) return
      const remaining = startedAt + timeoutMs - Date.now()
      if (remaining <= 0) break
      await delay(Math.min(50, remaining))
    } while (true)
    throw Error(`页面断言失败：${check.label}；等待 ${timeoutMs}ms 后实际：${JSON.stringify(check.actual)}（匹配 ${check.matchCount} 个）`)
  } catch (error) {
    check.error = error.message
    throw Object.assign(error, { kind: usage ? 'usage' : 'assertion' })
  } finally {
    check.elapsedMs = Date.now() - startedAt
    if (!usage) checks.push(check)
  }
}
