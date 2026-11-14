import { useEffect, useRef } from 'react'
import { parseRig, validateRig } from './vendor/packages/runtime/src/index'
import { projectAction, saveLipSync } from './vendor/src/editor/project'

export function useNarrativeBridge(state: any) {
  const current = useRef(state), version = useRef(0), signature = useRef('')
  current.current = state
  const nextSignature = JSON.stringify([state.rig, state.lipSync])
  if (signature.current !== nextSignature) { signature.current = nextSignature; version.current++ }
  useEffect(() => {
    const send = (payload: any) => parent.postMessage({ channel: 'narrative-mesh', ...payload }, location.origin)
    const snapshot = () => ({ projectName: current.current.localProject?.name || '', localVersion: version.current, dirty: current.current.dirty, busy: current.current.busy, rig: current.current.rig, lipSync: current.current.lipSync })
    let busy = false
    const handle = async (event: MessageEvent) => {
      if (event.source !== parent || event.origin !== location.origin || event.data?.channel !== 'narrative-mesh' || !event.data.requestId) return
      const { requestId, action, args = {} } = event.data
      try {
        if (busy || current.current.busy) throw Error('角色编辑器正在执行操作，请稍后重试')
        busy = true
        if (args.localVersion !== undefined && args.localVersion !== version.current) throw Error('模型已改变，请重新读取后编辑')
        if (action === 'edit') {
          if (!Array.isArray(args.operations) || !args.operations.length || args.operations.length > 100) throw Error('请提供 1–100 个编辑操作')
          const rig = structuredClone(current.current.rig)
          for (const op of args.operations) {
            if (typeof op.path !== 'string' || !/^[A-Za-z0-9_.]+$/.test(op.path)) throw Error('字段路径无效')
            const keys = op.path.split('.')
            if (keys.some((key: string) => ['__proto__', 'prototype', 'constructor'].includes(key))) throw Error('字段路径无效')
            let at = rig as any
            for (const key of keys.slice(0, -1)) { if (!at || typeof at !== 'object' || !Object.hasOwn(at, key)) throw Error('字段不存在：' + op.path); at = at[key] }
            if (!at || typeof at !== 'object' || !Object.hasOwn(at, keys.at(-1)!)) throw Error('字段不存在：' + op.path)
            at[keys.at(-1)!] = structuredClone(op.value)
          }
          current.current.update(parseRig(rig))
          send({ requestId, result: { accepted: true, rig } }); return
        }
        if (action === 'save') {
          const s = current.current
          if (!s.localProject || s.localProject.readOnly) throw Error('请先打开可编辑的角色工程')
          if (s.dirty) {
            await projectAction(s.localProject, 'rig', s.rig)
            if (s.lipSync) await saveLipSync(s.localProject, s.lipSync)
            s.saved()
          }
        } else if (action === 'rebuild') await current.current.runJob('rebuild')
        else if (action === 'preview') window.dispatchEvent(new CustomEvent('narrative-mesh-preview', { detail: args }))
        else if (action !== 'read' && action !== 'check') throw Error('未知角色编辑操作')
        send({ requestId, result: { ...snapshot(), ...(action === 'check' ? { issues: validateRig(current.current.rig) } : {}) } })
      } catch (error: any) { send({ requestId, error: error.message }) }
      finally { busy = false }
    }
    window.addEventListener('message', handle)
    send({ ready: true, state: snapshot() })
    return () => window.removeEventListener('message', handle)
  }, [])
  useEffect(() => { parent.postMessage({ channel: 'narrative-mesh', state: { projectName: state.localProject?.name || '', localVersion: version.current, dirty: state.dirty, busy: state.busy } }, location.origin) }, [state.localProject?.name, state.dirty, state.busy, nextSignature])
}
