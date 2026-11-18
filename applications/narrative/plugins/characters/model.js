export function createCharacter(project) {
  let index = project.characters.length + 1
  while (project.characters.some(character => character.name === `新角色 ${index}`)) index++
  return {
    id: `character-${crypto.randomUUID()}`, name: `新角色 ${index}`,
    description: '', personality: '', portrait: '',
    expressions: { neutral: '', happy: '', sad: '' }, color: '#b59475',
  }
}

export function characterReferences(project, id, withStory=true) {
  if(!withStory)return 0
  let count = 0
  for (const node of project.stories?.flatMap(s=>s.nodes)||project.nodes||[]) {
    if (node.stage.characterId === id) count++
    if (node.chat?.characterId === id) count++
    count += node.lines.filter(line => line.speaker === id).length
  }
  return count
}

/** 在同一次作品更新中清理所有契约内引用，保留台词与共享素材。 */
export function removeCharacter(project, id, withStory=true) {
  if(!withStory && (project.stories?.length || project.nodes?.length))throw Error('请先启用剧情资源插件，再删除角色，以便清理舞台和对白中的引用')
  project.characters = project.characters.filter(character => character.id !== id)
  if(!withStory)return
  for (const node of project.stories?.flatMap(s=>s.nodes)||project.nodes||[]) {
    if (node.stage.characterId === id) node.stage.characterId = ''
    if (node.chat?.characterId === id) node.chat.characterId = ''
    for (const line of node.lines) if (line.speaker === id) line.speaker = ''
  }
}

export function characterImage(character, key) {
  return key === 'portrait' ? character.portrait : character.expressions[key] || character.expressions.neutral || character.portrait
}
