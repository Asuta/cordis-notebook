import { Buffer } from 'node:buffer'

// 完整的本地模拟提供者。无网络、无密钥、无计费；输出固定 1×1 PNG。
// 接真实服务时替换 prepare/generate，保留同步校验、输入快照和取消语义。
export function createProvider({ id = 'local-example', label = '本地示例' } = {}) {
  const model = 'local-sample', ratios = ['1:1'], resolutions = ['sample']
  return {
    id, label: label + '（本地模拟）', defaultProvider: true,
    public: () => ({ model, hasKey: true, ratios: [...ratios], resolutions: [...resolutions], referenceImages: false, referenceVideos: false }),
    prepare(input) {
      if (typeof input.prompt !== 'string' || !input.prompt.trim() || input.prompt.length > 24000) throw Error('请填写最多 24000 字符的提示词')
      if (!Array.isArray(input.assetIds) || input.assetIds.length || input.references?.length) throw Error('本地示例不支持参考素材')
      if (!ratios.includes(input.ratio) || !resolutions.includes(input.resolution)) throw Error('本地示例只支持 1:1 / sample')
      if (input.model && input.model !== model) throw Error('本地示例模型不可用')
      if (Object.keys(input.parameters || {}).length || Object.keys(input.bindings || {}).length) throw Error('本地示例不支持额外参数或绑定')
      const snapshot = structuredClone(input)
      // 真实服务也应在此冻结私有配置；不要把密钥放进 public/parameters/bindings 或任务记录。
      return { model, outputKind: 'image', parameters: { ratio: snapshot.ratio, resolution: snapshot.resolution },
        async generate(media, signal) {
          signal.throwIfAborted()
          if (media.length) throw Error('本地示例不支持参考素材')
          return [{ kind: 'image', name: '本地模拟 · ' + snapshot.prompt.slice(0, 32),
            bytes: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAADUlEQVQImWMonRT8HwAFNAJaQ3+LSgAAAABJRU5ErkJggg==', 'base64') }]
        },
      }
    },
  }
}
