import { stat } from 'node:fs/promises'
import { loadPi } from './pi-sdk.js'
import { skillRule } from './skills-config.js'

export async function scanSkills(root, config) {
  if (!config.directory) return { skills: [], diagnostics: [] }
  try {
    if (!(await stat(config.directory)).isDirectory()) throw Error('技能路径不是文件夹')
    const { loadSkills } = await loadPi()
    return loadSkills({ cwd: root, skillPaths: [config.directory], includeDefaults: false })
  } catch (error) {
    return { skills: [], diagnostics: [{ type: 'error', path: config.directory, message: error.code === 'ENOENT' ? '技能目录不存在' : error.message }] }
  }
}

export async function skillCatalog(root, config) {
  const { skills, diagnostics } = await scanSkills(root, config)
  return { directory: config.directory, diagnostics, skills: skills.map(skill => ({
    name: skill.name, description: skill.description, path: skill.filePath,
    manualOnly: skill.disableModelInvocation, ...skillRule(config, skill.filePath),
  })) }
}

export function skillPrompt(prompt, skills) {
  const command = /^\/skill:(\S+)(?:\s+|$)/.exec(prompt)
  if (!command) return prompt
  if (!skills.some(skill => skill.name === command[1])) throw Error(`当前应用没有可用的技能“${command[1]}”，请检查技能目录、启用状态和适用范围。`)
  // Pi expands a leading /skill:name separated from its arguments by a space.
  const args = prompt.slice(command[0].length)
  return `/skill:${command[1]}${args ? ' ' + args : ''}`
}
