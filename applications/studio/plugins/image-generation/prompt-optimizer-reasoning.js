export const reasoningModes = [
  ['default', '跟随服务默认'],
  ['off', '关闭推理'],
  ['on', '开启推理'],
]

export const reasoningEfforts = [
  ['minimal', '极低（Minimal）'],
  ['low', '低（Low）'],
  ['medium', '中（Medium）'],
  ['high', '高（High）'],
  ['xhigh', '极高（XHigh）'],
  ['max', '最高（Max）'],
]

export function reasoningLabel(item) {
  if (item.reasoningMode === 'off') return '推理：关闭'
  if (item.reasoningMode === 'on') return '推理：' + (reasoningEfforts.find(([value]) => value === item.reasoningEffort)?.[1] || '中（Medium）')
  return '推理：跟随服务默认'
}
