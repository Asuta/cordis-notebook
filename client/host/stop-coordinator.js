/** The preparation phase can veto a managed change; disposal never can. */
export class StopCoordinator {
  constructor(ctx, report = console.error) { this.ctx = ctx; this.report = report; this.running = false }

  /** @param {import('../contracts/index.d.ts').StopChange} change */
  async run(change, action) {
    if (this.running) throw new Error('已有插件变更正在准备，请稍后重试')
    this.running = true
    const releases = []
    let accepting = true
    const request = Object.freeze({ ...change, targets: Object.freeze([...change.targets]),
      hold(release) {
        if (!accepting) throw new Error('停止准备阶段已结束')
        if (typeof release !== 'function') throw new TypeError('hold 需要释放函数')
        releases.push(release)
      },
    })
    try {
      const rejection = await this.ctx.serial('plugins/before-stop', request)
      accepting = false
      if (rejection !== undefined && rejection !== null && rejection !== false) throw new Error(String(rejection))
      return await action()
    } finally {
      accepting = false
      for (const release of releases.reverse()) { try { await release() } catch (error) { this.report(error) } }
      this.running = false
    }
  }
}
