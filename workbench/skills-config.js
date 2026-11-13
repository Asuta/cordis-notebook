import { isAbsolute, normalize } from 'node:path'

export function validateSkills(input = { directory: '', rules: [] }) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw Error('技能设置必须是对象')
  const { directory = '', rules = [] } = input
  if (typeof directory !== 'string' || directory.length > 4096 || directory.includes('\0')
    || directory.trim() && !isAbsolute(directory.trim())) throw Error('技能目录必须是完整的绝对路径，留空可关闭技能加载')
  if (!Array.isArray(rules) || rules.length > 2000) throw Error('技能规则必须是数组，最多 2000 项')
  const paths = new Set()
  const clean = rules.map(rule => {
    if (!rule || typeof rule.path !== 'string' || rule.path.length > 4096 || rule.path.includes('\0') || !isAbsolute(rule.path)) throw Error('技能规则必须指定完整的文件路径')
    const path = normalize(rule.path)
    if (paths.has(path)) throw Error('同一个技能不能重复配置')
    paths.add(path)
    if (typeof rule.enabled !== 'boolean') throw Error('技能启用状态必须为布尔值')
    if (rule.apps !== null && (!Array.isArray(rule.apps) || !rule.apps.length || rule.apps.length > 100
      || rule.apps.some(id => typeof id !== 'string' || !/^[a-z][a-z0-9-]{1,49}$/.test(id)))) throw Error('请为限定应用的技能至少选择一个应用')
    return { path, enabled: rule.enabled, apps: rule.apps === null ? null : [...new Set(rule.apps)] }
  })
  return { directory: directory.trim() ? normalize(directory.trim()) : '', rules: clean }
}

export function skillRule(config, path) {
  return config.rules.find(rule => rule.path === normalize(path)) || { path, enabled: true, apps: null }
}

export function skillsForApp(catalog, config, appId) {
  return { ...catalog, skills: catalog.skills.filter(skill => {
    const rule = skillRule(config, skill.filePath)
    return rule.enabled && (rule.apps === null || rule.apps.includes(appId))
  }) }
}
