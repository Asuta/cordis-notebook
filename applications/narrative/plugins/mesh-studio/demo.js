export function configureDemo(project, characterId) {
  const background = project.nodes[0].stage.background
  project.title = 'Miko · 动态角色演示'
  project.description = '体验动态立绘的转头、表情、口型和待机，再打开角色工作室调整绑定。'
  project.characters = project.characters.filter(c => c.id === characterId)
  project.variables = []; project.startNodeId = 'welcome'
  const stage = expression => ({ background, characterId, expression, position: 50, scale: 100 })
  const node = (id, title, text, expression = 'neutral') => ({ id, type: 'story', title, stage: stage(expression), lines: [{ speaker: characterId, text }], choices: [], next: 'welcome' })
  project.nodes = [
    { ...node('welcome', '01 · 和 Miko 打个招呼', '你好，我是 Miko。即使停在这句对白，我也会眨眼、呼吸，发饰会轻轻摆动。'), next: '', choices: [
      { id: 'choose-left', text: '向左边看看', target: 'left', actions: [] },
      { id: 'choose-right', text: '向右边看看', target: 'right', actions: [] },
      { id: 'choose-wink', text: '给我一个俏皮的表情', target: 'wink', actions: [] },
      { id: 'choose-motion', text: '环顾四周', target: 'motion', actions: [] },
    ] },
    node('left', '02 · 左转头', '这边有什么呢？剧情中的姿态会平滑过渡，眼睛和脸部跟随转动。'),
    node('right', '03 · 右转头', '再看看另一边。你可以在属性与规则里调整这个角度。', 'happy'),
    node('wink', '04 · 表情演出', '这样可以吗？编辑器和剧情舞台使用同一套角色素材与绑定。', 'wink'),
    node('motion', '05 · 环顾动作', '让我看看周围。等我说完这句，预制的环顾动作还会继续。'),
  ]
  project.rules = [
    { id: 'turn-left', name: '向左转头', event: 'node.enter', nodeId: 'left', once: false, actions: [{ type: 'mesh-pose', angleX: -25, angleY: 3, angleZ: 2, gazeX: -.6 }] },
    { id: 'turn-right', name: '向右转头', event: 'node.enter', nodeId: 'right', once: false, actions: [{ type: 'mesh-pose', angleX: 25, angleY: 2, angleZ: -2, gazeX: .6 }] },
    { id: 'look-around', name: '环顾四周', event: 'node.enter', nodeId: 'motion', once: false, actions: [{ type: 'mesh-motion', id: 'lookAround' }] },
  ]
}
