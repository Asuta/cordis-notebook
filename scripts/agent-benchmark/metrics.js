const parse = value => { try { return JSON.parse(value) } catch { return value || {} } }
export function unionMs(events) {
  const spans = events.filter(e => Number.isFinite(e.startedAt) && Number.isFinite(e.endedAt) && e.endedAt >= e.startedAt)
    .map(e => [e.startedAt, e.endedAt]).sort((a, b) => a[0] - b[0])
  let total = 0, end = -Infinity
  for (const [a, b] of spans) { total += Math.max(0, b - Math.max(a, end)); end = Math.max(end, b) }
  return total
}
export function metrics(turns, task) {
  const events = turns.flatMap(t => t.events || []), tools = events.filter(e => e.kind === 'tool'), models = events.filter(e => e.kind === 'model')
  const prefix = `applications/${task.appId}/plugins/${task.pluginId}/`
  const edits = tools.filter(e => {
    const path = String(parse(e.input).path || '').replaceAll('\\', '/')
    const index = path.indexOf(prefix), tail = index < 0 ? '' : path.slice(index + prefix.length)
    return ['write', 'edit'].includes(e.name) && e.status === 'done' && tail && !/(^|\/)(test|tests|dist)\//.test(tail) && /\.(?:[cm]?js|jsx|tsx?|css)$/.test(tail)
  }).sort((a, b) => a.startedAt - b.startedAt)
  return {
    firstEditMs: edits.length ? edits[0].startedAt - turns[0].startedAt : null,
    firstEditScope: '首次成功 write/edit 业务源码调用的开始；不含骨架、测试、命令写文件，未观测到则为空',
    agentActiveMs: unionMs(turns), modelMs: unionMs(models), toolMs: unionMs(tools),
    modelWaitMs: models.reduce((sum, e) => sum + (e.timing?.waitMs || 0), 0),
    modelStreamingMs: models.reduce((sum, e) => sum + (e.timing?.streamingMs || 0), 0),
    modelCalls: models.length, toolCalls: tools.length, toolErrors: tools.filter(e => e.status === 'error').length,
    agentBrowserMs: unionMs(tools.filter(e => e.name?.startsWith('browser_'))),
    agentBrowserAttempts: turns.flatMap(t => t.browserVerification ? [...(t.browserVerification.previousAttempts || []), t.browserVerification] : [])
      .map(({ id, status, checks = [] }) => ({ id, status, passed: checks.filter(c => c.passed).length, failed: checks.filter(c => !c.passed).length })),
  }
}
export function aggregate(trials) {
  const median = values => { const v = values.filter(Number.isFinite).sort((a, b) => a - b); return v.length ? (v[Math.floor((v.length - 1) / 2)] + v[Math.floor(v.length / 2)]) / 2 : null }
  return [...new Set(trials.map(t => t.caseId))].map(caseId => {
    const rows = trials.filter(t => t.caseId === caseId), passed = rows.filter(t => t.status === 'passed')
    return { caseId, trials: rows.length, passed: passed.length, firstPass: rows.filter(t => t.status === 'passed' && t.attempts.length === 1).length,
      timeouts: rows.filter(t => t.status === 'timeout').length, failed: rows.filter(t => t.status === 'failed').length,
      infrastructureErrors: rows.filter(t => t.status === 'infrastructure-error').length,
      medianFirstEditMs: median(rows.map(t => t.metrics?.firstEditMs)), medianSuccessfulCompletionMs: median(passed.map(t => t.completionMs)),
      repairs: rows.reduce((sum, t) => sum + (t.repairTurns ?? Math.max(0, (t.attempts?.length || 0) - 1)), 0) }
  })
}
export function markdown(report) {
  const seconds = v => Number.isFinite(v) ? (v / 1000).toFixed(1) + ' 秒' : '—'
  return `# Agent 完整开发评测\n\n代码：${report.source.commit}；资料/验收指纹：${report.suiteHash}。\n模型：${report.model}；思考：${report.effort}；每轮总时限：${report.timeoutSeconds} 秒；最多返工：${report.repairs} 次。\n\n` +
    '| 任务 | 首次验收通过/全部 | 最终通过/全部 | 成功完成耗时中位数 | 超时 | 基础设施错误 |\n| --- | --- | --- | --- | --- | --- |\n' +
    aggregate(report.trials).map(r => `| ${r.caseId} | ${r.firstPass}/${r.trials} | ${r.passed}/${r.trials} | ${seconds(r.medianSuccessfulCompletionMs)} | ${r.timeouts} | ${r.infrastructureErrors} |`).join('\n') +
    '\n\n| 轮次 | 模型等待 | 模型流式输出 | 工具执行 | Agent 浏览器工具 | 外部固定验收 | 返工轮数 |\n| --- | --- | --- | --- | --- | --- | --- |\n' +
    report.trials.map(t => `| ${t.id} | ${seconds(t.metrics?.modelWaitMs)} | ${seconds(t.metrics?.modelStreamingMs)} | ${seconds(t.metrics?.toolMs)} | ${seconds(t.metrics?.agentBrowserMs)} | ${seconds(t.metrics?.acceptanceMs)} | ${t.repairTurns ?? Math.max(0, (t.attempts?.length || 0) - 1)} |`).join('\n') +
    '\n\n完成耗时从首次发送任务到固定验收全部通过，包含返工与外部验收，不含最初复制/构建/启动准备。失败、超时和基础设施错误全部保留；仅成功样本计算完成耗时中位数，不能据此忽略失败率。首次通过指第一次外部固定验收，不代表 Agent 内部从未返工。模型、工具可能重叠，耗时不可直接相加；模型等待包含网络和服务排队。\n\n' +
    report.trials.map(t => `- ${t.id}：${t.status}；首次代码编辑 ${seconds(t.metrics?.firstEditMs)}；完成 ${seconds(t.completionMs)}；外部验收 ${t.attempts?.length || 0} 次。${t.error ? ' ' + String(t.error).replace(/\s+/g, ' ') : ''}`).join('\n') +
    '\n\n完整标准、各项断言、原始会话、阶段耗时和失败现场见 report.json 与各轮目录。评测只覆盖列明场景，不代表任意插件或视觉质量全面合格。\n'
}
