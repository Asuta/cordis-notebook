import { test } from 'node:test'
import assert from 'node:assert/strict'
import { actionLabel, createTimer, FOCUS_DURATION_MS, formatDuration, pauseTimer, remainingMsOf, resetTimer, startTimer, syncTimer } from '../timer.js'

const START = 1_700_000_000_000
const second = n => n * 1000

test('新计时器为 25:00 待机状态', () => {
  const timer = createTimer()
  assert.equal(timer.status, 'idle')
  assert.equal(timer.duration, 25 * 60 * 1000)
  assert.equal(formatDuration(remainingMsOf(timer, START)), '25:00')
  assert.equal(remainingMsOf(timer, START + second(600)), FOCUS_DURATION_MS, '待机时剩余时间不受时钟影响')
})

test('运行中剩余时间按结束时间推进，重复开始不改变本轮终点', () => {
  const started = startTimer(createTimer(), START)
  assert.equal(started.status, 'running')
  assert.equal(started.endsAt, START + FOCUS_DURATION_MS)
  assert.equal(startTimer(started, START + second(30)), started, '运行中再次开始是空操作')
  assert.equal(remainingMsOf(started, START + second(90)), FOCUS_DURATION_MS - second(90))
  assert.equal(formatDuration(remainingMsOf(started, START + second(90))), '23:30')
})

test('暂停保留当前剩余时间，继续时不回到整轮时长', () => {
  const running = startTimer(createTimer(), START)
  const paused = pauseTimer(running, START + second(120))
  assert.equal(paused.status, 'paused')
  assert.equal(paused.endsAt, 0)
  assert.equal(formatDuration(remainingMsOf(paused, START + second(900))), '23:00', '暂停后不再走钟')
  const resumed = startTimer(paused, START + second(900))
  assert.equal(resumed.status, 'running')
  assert.equal(resumed.endsAt, START + second(900) + 23 * 60 * 1000)
})

test('一轮走完进入结束态并只报告一次结束', () => {
  const running = startTimer(createTimer(), START)
  const midway = syncTimer(running, START + second(60))
  assert.equal(midway.finished, false)
  assert.equal(midway.timer.status, 'running')
  const done = syncTimer(midway.timer, START + FOCUS_DURATION_MS)
  assert.equal(done.finished, true)
  assert.equal(done.timer.status, 'finished')
  assert.equal(done.timer.remainingMs, 0)
  assert.equal(formatDuration(remainingMsOf(done.timer, START + second(9000))), '00:00')
  assert.equal(syncTimer(done.timer, START + second(9001)).finished, false, '结束态不会重复提醒')
})

test('结束后再次开始是新的一轮，重置回到待机', () => {
  const done = syncTimer(startTimer(createTimer(), START), START + FOCUS_DURATION_MS).timer
  const again = startTimer(done, START + second(5))
  assert.equal(again.endsAt, START + second(5) + FOCUS_DURATION_MS)
  assert.equal(resetTimer(again).status, 'idle')
  assert.equal(resetTimer(again).remainingMs, FOCUS_DURATION_MS)
  assert.equal(formatDuration(remainingMsOf(resetTimer(again), START)), '25:00')
})

test('按钮文案与显示格式覆盖三种状态且不出现负数', () => {
  assert.equal(actionLabel('idle'), '开始')
  assert.equal(actionLabel('running'), '暂停')
  assert.equal(actionLabel('paused'), '继续')
  assert.equal(actionLabel('finished'), '开始')
  assert.equal(formatDuration(-1), '00:00')
  assert.equal(formatDuration(0), '00:00')
  assert.equal(formatDuration(999), '00:01')
  assert.equal(formatDuration(1_500_000), '25:00')
})
