// Official /models metadata, verified 2026-09-27. Keep the actual window separate
// from the user's earlier compaction threshold and our per-response output budget.
import { validateSkills } from './skills-config.js'

export const MODELS = [
  { id: 'deepseek-flash', name: 'DeepSeek V4.1 Flash', images: true, contextWindow: 1048576 },
]
export const OUTPUT_TOKENS = 16384
export const DEFAULT_COMPACTION = { enabled: true, threshold: 128000, keepRecentTokens: 20000 }
export const DEFAULT_MAX_CONCURRENT_AGENTS = 3
export function modelInfo(id) {
  const model = MODELS.find(model => model.id === id)
  if (!model) throw Error('不支持的模型选项')
  return model
}
export function normalizeConfig(input = {}) {
  // Persisted settings may name a removed model; all new tasks use Flash.
  return { baseUrl: 'https://api.deepseek.com/v1', thinking: true, reasoningEffort: 'high', customSystemPrompt: '',
    maxConcurrentAgents: DEFAULT_MAX_CONCURRENT_AGENTS, ...input, model: MODELS[0].id,
    compaction: { ...DEFAULT_COMPACTION, ...input.compaction }, skills: validateSkills(input.skills) }
}
export function validateSettings(input, previous) {
  if (input.model !== undefined) modelInfo(input.model)
  const next = normalizeConfig({ ...previous, ...input, compaction: { ...previous.compaction, ...input.compaction } })
  if (typeof next.customSystemPrompt !== 'string' || next.customSystemPrompt.length > 50000) throw Error('自定义系统提示词必须是 50000 字以内的文本')
  if (!Number.isInteger(next.maxConcurrentAgents) || next.maxConcurrentAgents < 1 || next.maxConcurrentAgents > 8) throw Error('并行 Agent 数量只能设置为 1–8')
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
