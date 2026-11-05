const states = { queued: '排队中', paused: '已暂停查询', uncertain: '提交结果待确认', failed: '生成失败', interrupted: '生成已中断', detached: '已结束跟踪', succeeded: '结果保留在素材库' }

export function pendingLabel(node, s) {
  const job = (s.state.jobs || []).find(item => item.id === node.jobId)
  if (!s.actions.get('generate')) return '生成插件未启用'
  if (job?.status === 'running') return '正在生成' + (node.type === 'video' ? '视频' : '图片') + '…'
  return states[job?.status] || '任务记录不可用'
}

export function renderPending(node, card, view, s) {
  if (node.assetId) return false
  card.querySelector('.studio-port')?.remove()
  const { el, button } = view, job = (s.state.jobs || []).find(job => job.id === node.jobId)
  const active = ['queued', 'running'].includes(job?.status), video = node.type === 'video'
  const area = el('div', { class: 'studio-pending-media' + (active ? ' is-active' : ''), role: 'status', 'aria-label': '生成任务占位框' })
  area.append(el('span', { class: 'studio-pending-spinner', 'aria-hidden': 'true' }, active ? '' : '◇'), el('strong', {}, pendingLabel(node, s)), el('small', {}, job ? `任务 ${job.id.slice(0, 8)} · ${video ? '视频' : '图片'}` : '请启用生成插件查看任务'))
  const foot = el('div', { class: 'studio-pending-details' })
  if (job?.error) foot.append(el('p', { class: 'studio-pending-error' }, job.error))
  if (job?.remote?.taskId) foot.append(el('code', {}, '远端 ID：' + job.remote.taskId))
  const actions = el('div', { class: 'studio-pending-actions' })
  if (active && s.actions.get('cancel')) {
    const resumable = s.state.providers?.find(provider => provider.id === job.provider)?.resumable
    actions.append(button(job.status === 'queued' ? '取消排队' : resumable ? '■ 暂停查询' : '■ 停止生成', () => s.execute('cancel', { jobId: job.id })))
  }
  if (job?.status === 'paused' && s.actions.get('resume')) actions.append(button('恢复查询', () => s.execute('resume', { jobId: job.id })))
  if (['paused', 'uncertain'].includes(job?.status) && s.actions.get('detach')) actions.append(button('结束本地跟踪', () => { if (window.confirm('远端任务可能仍在运行并计费。是否结束此任务的本地跟踪？')) return s.execute('detach', { jobId: job.id }) }))
  foot.append(actions); card.append(area, foot); return true
}
