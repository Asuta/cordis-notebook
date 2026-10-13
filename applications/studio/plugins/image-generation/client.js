import React from 'react'
import { ConfigPanel, PromptPanel } from './panels.js'
export default function (ctx, sdk) {
  const s = ctx.canvasSession, view = ctx.canvasUI
  const { el, button, safe, field, flush, edit, board, api, refresh } = view
  s.actions.register(ctx, { id: 'generate', label: '生成图片', schema: { type: 'object', properties: { nodeId: { type: 'string' } }, required: ['nodeId'] },
    async run({ nodeId, revision }) {
      if (revision !== undefined && revision !== s.board().revision) throw Error('画布已变化，请重新读取')
      const job = await api('/generate', { boardId: s.boardId, nodeId, revision: revision ?? s.board().revision, requestId: crypto.randomUUID() })
      await refresh(); return job
    },
  })
  view.menu(ctx, { id: 'generator', label: '✦ 生成卡片', order: 30, className: 'studio-primary', run: () => view.add('generator') })
  const createFirst = button('创建第一张生成卡片', () => view.add('generator'), 'studio-primary')
  view.empty.insertBefore(createFirst, view.empty.querySelector('small'))
  ctx.effect(() => () => createFirst.remove())
  function props(node, helpers) {
    const providers = s.state.providers || [], provider = node.provider ? providers.find(p => p.id === node.provider) : providers[0]
    const incoming = board().edges.filter(edge => edge.to === node.id).map(edge => ({ edge, from: board().nodes.find(n => n.id === edge.from) })).filter(item => item.from)
    const job = (s.state.jobs || []).filter(j => j.boardId === s.boardId && j.nodeId === node.id).at(-1), busy = ['queued', 'running'].includes(job?.status)
    const status = job ? ({ queued: '排队中', running: '正在生成…', succeeded: '已生成 · 结果保留在右侧', failed: '生成失败', interrupted: '生成已中断' }[job.status] + (job.error ? ' · ' + job.error : '')) : provider ? (provider.hasKey === false ? '请先配置图片服务' : '') : '图片服务不可用，请启用对应插件'
    return { node, ...helpers, providers, provider, incoming, busy, status, imageUrl: view.imageUrl,
      canGenerate: !!provider && (!!node.prompt?.trim() || incoming.some(item => item.from.type === 'image' || item.from.text?.trim())),
      change: safe(async patch => { await flush(); await edit([{ type: 'update', id: node.id, patch }]); view.render() }),
      run: safe(async event => { event.currentTarget.focus(); if (busy) await api('/cancel', { id: job.id }).then(refresh); else await s.execute('generate', { nodeId: node.id }); }),
      disconnect: safe(async id => { await flush(); await edit([{ type: 'disconnect', id }]); }),
      reorder: safe(async index => { if (!index) return; const ids = incoming.map(item => item.edge.id); [ids[index - 1], ids[index]] = [ids[index], ids[index - 1]]; await flush(); await edit([{ type: 'reorder', id: node.id, edges: ids }]); }),
    }
  }
  view.register(ctx, { id: 'generator', label: '生成配置', icon: '✦', input: true, upstream: true,
    actions: [{ label: '编辑提示词', run: node => view.editNode(node.id, 'prompt') }],
    render(node, card) { return view.nodeCard(node, card, { kind: 'config', input: true,
      content: (current, helpers) => React.createElement(ConfigPanel, props(current, helpers)),
      panel: (current, helpers) => React.createElement(PromptPanel, props(current, helpers)),
    }) },
  })
}
