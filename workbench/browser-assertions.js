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
          : kind === 'placeholder' ? /^(INPUT|TEXTAREA)$/.test(element.tagName)
          : kind === 'disabled' ? /^(BUTTON|INPUT|TEXTAREA|SELECT|OPTION|OPTGROUP|FIELDSET)$/.test(element.tagName) || /^(button|menuitem|menuitemcheckbox|menuitemradio|checkbox|radio|textbox|combobox|slider|spinbutton|switch|tab|treeitem)$/.test(element.getAttribute('role') || '') : true
        return { count: 1, visible, supported, rect: { width: rect.width, height: rect.height }, display: style.display, visibility: style.visibility,
          actual: kind === 'visible' ? visible : kind === 'disabled' ? element.matches(':disabled') || element.closest('[aria-disabled="true"], [aria-disabled="false"]')?.getAttribute('aria-disabled') === 'true' : kind === 'value' ? element.value
          : kind === 'placeholder' ? element.getAttribute('placeholder') : element.innerText || '' }
      }, assertion)
      check.matchCount = sample.count
      check.visible = sample.visible
      check.rect = sample.rect
      check.display = sample.display
      check.visibility = sample.visibility
      if (sample.count > 1) throw Object.assign(Error(`定位需要唯一元素，实际匹配 ${sample.count} 个`), {
        diagnostics: { target: input.target, matchCount: sample.count, candidates: sample.candidates } })
      if (sample.supported === false) {
        usage = true
        throw usageError(`${assertion} 断言需要对应的交互控件；普通文字请用 text`)
      }
      const actual = assertion === 'visible' ? sample.visible : sample.actual
      check.actual = typeof actual === 'string' ? actual.slice(0, 3000) : actual ?? null
      check.passed = assertion === 'visible' ? actual === input.expected
        : sample.count === 1 && sample.visible && (assertion === 'text' ? actual.includes(input.expected) : actual === input.expected)
      check.failedCondition = check.passed ? null : sample.count !== 1 ? 'missing-target' : !sample.visible ? 'visibility' : assertion
      if (check.passed) return
      const remaining = startedAt + timeoutMs - Date.now()
      if (remaining <= 0) break
      await delay(Math.min(50, remaining))
    } while (true)
    throw Object.assign(Error(`页面断言失败：${check.label}；未满足条件：${check.failedCondition}；等待 ${timeoutMs}ms 后实际：${JSON.stringify(check.actual)}（匹配 ${check.matchCount} 个，可见=${check.visible}）`), {
      diagnostics: { ...check, hint: check.failedCondition === 'visibility' ? '目标本身不可见或没有尺寸；检查 rect/display/visibility，选择实际可见的卡片或输入控件，不要降低断言要求。' : '核对目标、预期值及前置操作。' },
    })
  } catch (error) {
    check.error = error.message
    throw Object.assign(error, { kind: usage ? 'usage' : 'assertion' })
  } finally {
    check.elapsedMs = Date.now() - startedAt
    if (!usage) checks.push(check)
  }
}
