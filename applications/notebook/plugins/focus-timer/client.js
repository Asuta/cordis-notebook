import { actionLabel, createTimer, FINISH_MESSAGE, formatDuration, pauseTimer, remainingMsOf, resetTimer, startTimer, syncTimer } from './timer.js'

/** 显示刷新间隔；剩余时间按结束时间校正，这里只影响显示平滑度。 */
const TICK_MS = 250

export default function (ctx, sdk) {
  let timer = createTimer(), handle = null
  const root = sdk.el('div', { class: 'focus-timer', 'aria-label': '专注计时器' })
  root.setAttribute('role', 'group')
  const caption = sdk.el('span', { class: 'focus-timer-caption' }, '专注')
  const clock = sdk.el('span', { class: 'focus-timer-clock' })
  const toggle = sdk.el('button', { class: 'focus-timer-action', type: 'button' })
  const reset = sdk.el('button', { class: 'focus-timer-action', type: 'button' }, '重置')
  const notice = sdk.el('span', { class: 'focus-timer-notice', 'aria-live': 'polite' })
  notice.setAttribute('role', 'status')
  root.append(caption, clock, toggle, reset, notice)
  sdk.mount('footer', root)

  const stopTicking = () => { if (handle !== null) { clearInterval(handle); handle = null } }
  const render = () => {
    clock.textContent = formatDuration(remainingMsOf(timer, Date.now()))
    toggle.textContent = actionLabel(timer.status)
    toggle.setAttribute('aria-label', actionLabel(timer.status) + '专注计时')
    reset.disabled = timer.status === 'idle'
    root.dataset.status = timer.status
    notice.textContent = timer.status === 'finished' ? FINISH_MESSAGE : ''
  }
  const tick = () => {
    timer = syncTimer(timer, Date.now()).timer
    if (timer.status !== 'running') stopTicking()
    render()
  }
  const schedule = () => { if (handle === null) handle = setInterval(tick, TICK_MS) }

  sdk.listen(toggle, 'click', () => {
    if (timer.status === 'running') { timer = pauseTimer(timer, Date.now()); stopTicking() }
    else { timer = startTimer(timer, Date.now()); schedule() }
    render()
  })
  sdk.listen(reset, 'click', () => { timer = resetTimer(timer); stopTicking(); render() })
  // 只清理自己创建的定时器；节点与监听器由挂载和 sdk.listen 随上下文释放。
  ctx.effect(() => () => stopTicking())
  render()
}
