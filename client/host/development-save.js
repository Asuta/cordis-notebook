/** Pair each release with its preparation, including delayed events from frozen tabs. */
export function installDevelopmentSave({ hot, enqueue, protect, ready, report }) {
  const rounds = new Map()
  const resume = ({ token }) => rounds.get(token)?.release()
  const prepare = ({ token }) => {
    if (rounds.has(token)) return
    let released = false, release
    const resumed = new Promise(resolve => { release = () => { released = true; resolve() } })
    rounds.set(token, { release })
    hot.send('cordis:save-progress', { token, phase: 'queued' })
    const task = enqueue(async () => {
      // The server may have timed out before this task reached the front of the queue.
      if (released) { ready(); return }
      hot.send('cordis:save-progress', { token, phase: 'saving' })
      await protect(async () => {
        if (released) { ready(); return }
        hot.send('cordis:prepared', { token, success: true })
        await resumed
      })
      // A slow save may complete after timeout. Request a fresh, protected attempt.
      ready()
    })
    void task.catch(error => {
      release()
      hot.send('cordis:prepared', { token, success: false, error: error.message })
      report(error.message)
    }).finally(() => rounds.delete(token))
  }
  hot.on('cordis:prepare', prepare); hot.on('cordis:resume', resume)
  return () => {
    hot.off('cordis:prepare', prepare); hot.off('cordis:resume', resume)
    for (const round of rounds.values()) round.release()
    rounds.clear()
  }
}
