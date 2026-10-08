import { randomUUID } from 'node:crypto'

/** Private child-process RPC. No development execution endpoint is exposed over HTTP. */
export function developmentRPC(channel, handlers = {}) {
  const pending = new Map()
  let closed = false
  const send = message => { if (channel.connected) channel.send(message, () => {}) }
  const receive = async message => {
    if (message?.type !== 'cordis-rpc') return
    if (message.method) {
      try {
        if (!Object.hasOwn(handlers, message.method)) throw Error('未知开发操作')
        send({ type: 'cordis-rpc', id: message.id, result: await handlers[message.method](message.data) })
      } catch (error) { send({ type: 'cordis-rpc', id: message.id, error: error.message }) }
    } else {
      const task = pending.get(message.id)
      if (!task) return
      pending.delete(message.id); clearTimeout(task.timer)
      message.error ? task.reject(Error(message.error)) : task.resolve(message.result)
    }
  }
  const close = () => {
    if (closed) return
    closed = true; channel.off('message', receive); channel.off('disconnect', close); channel.off('exit', close)
    for (const task of pending.values()) { clearTimeout(task.timer); task.reject(Error('开发后端连接已关闭')) }
    pending.clear()
  }
  channel.on('message', receive); channel.once('disconnect', close); channel.once('exit', close)
  return { close, call(method, data) {
    if (closed || !channel.connected) return Promise.reject(Error('开发后端未连接'))
    return new Promise((resolve, reject) => {
      // Lifecycle work is serialized by its owner. Timing out an uncancellable commit
      // would let the caller roll back while the child is still activating plugins.
      const id = randomUUID(), timer = undefined
      pending.set(id, { resolve, reject, timer }); send({ type: 'cordis-rpc', id, method, data })
    })
  } }
}
