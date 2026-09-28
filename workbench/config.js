// Official /models metadata, verified 2026-09-27. Keep the actual window separate
// from the user's earlier compaction threshold and our per-response output budget.
export const MODELS = [
  { id: 'deepseek-v4-pro', name: 'DeepSeek V4 Pro', images: false, contextWindow: 1048576 },
  { id: 'deepseek-flash', name: 'DeepSeek V4.1 Flash', images: true, contextWindow: 1048576 },
]
export const OUTPUT_TOKENS = 16384
export const DEFAULT_COMPACTION = { enabled: true, threshold: 128000, keepRecentTokens: 20000 }
export const modelInfo = id => MODELS.find(model => model.id === id) || { id, name: id, images: false, contextWindow: 1048576 }
export function normalizeConfig(input = {}) {
  return { baseUrl: 'https://api.deepseek.com/v1', model: MODELS[0].id, thinking: true, reasoningEffort: 'high', ...input,
    compaction: { ...DEFAULT_COMPACTION, ...input.compaction } }
}
export function validateSettings(input, previous) {
  const next = normalizeConfig({ ...previous, ...input, compaction: { ...previous.compaction, ...input.compaction } })
  if (!['low', 'high', 'max'].includes(next.reasoningEffort)) throw Error('推理强度只能选择 Low、High 或 Max')
  const { threshold, keepRecentTokens, enabled } = next.compaction
  if (typeof enabled !== 'boolean' || !Number.isInteger(threshold) || !Number.isInteger(keepRecentTokens)
    || keepRecentTokens < 1000 || threshold < keepRecentTokens + OUTPUT_TOKENS * 2
    || threshold > modelInfo(next.model).contextWindow - OUTPUT_TOKENS) throw Error('压缩阈值须大于保留量 + 32768，且小于模型窗口 - 16384；保留量至少 1000 tokens')
  return next
}
export function piCompaction(config) {
  const value = normalizeConfig(config)
  // Pi triggers at contextWindow - reserveTokens, including between tool rounds.
  // Summary generation is capped by model.maxTokens (16384), not this reserve.
  return { enabled: value.compaction.enabled, keepRecentTokens: value.compaction.keepRecentTokens,
    reserveTokens: modelInfo(value.model).contextWindow - value.compaction.threshold }
}
