import { blankProject, upgradeProject, syncLegacy } from '../model.js'
import { modelSummary } from '../live2d/document.js'

export function mikoDemo(project, model) {
  const p = upgradeProject(blankProject('海风里的邀请 · Miko 官方角色', project.id))
  p.assets = project.assets; p.models = [modelSummary(model)]
  p.description = '使用 Mesh Avatar Studio 官方 Miko 预制人物与原生播放库。演示左右转头、俯仰、视线、表情、口型和发饰物理；两个结局。Miko © Yuki Shindo (AITuber OnAir)，本示例为独立集成演示。'
  p.cast = [{ id: 'miko', name: 'Miko', portraitId: '', modelId: model.id, color: '#ffd1bc', expressions: [] }]
  p.variables = [{ id: 'stay', name: '留下听海', kind: 'boolean', initial: false }]
  let n = 0
  const cue = (type, values = {}) => ({ id: 'miko-cue-' + ++n, type, ...values })
  const say = (text, speakerId = 'miko') => cue('say', { speakerId, text })
  const pose = (parameters = {}, expressionId = 'neutral', motionId = '') => cue('model', { characterId: 'miko', parameters, expressionId, motionId, idle: true })
  const show = () => cue('show', { characterId: 'miko', expressionId: '', x: 56, y: -3, scale: 1, opacity: 1, duration: 700 })
  const scene = (id, title, commands, choices = [], ending = false) => { const s = { id, title, commands, choices, ending, backgroundId: '', musicId: '', leftCharacterId: '', rightCharacterId: '', lines: [] }; syncLegacy(s); return s }
  p.scenes = [
    scene('invitation', '序章 · 窗边的海风', [
      cue('background', { assetId: 'observatory', duration: 700 }), cue('music', { assetId: 'rain-theme', volume: .35, duration: 1000 }), show(),
      pose({}, 'smile', 'greeting'), say('欢迎回来。今晚的海风，好像带来了一封没有署名的邀请。'),
      pose({ angleX: -28, gazeX: -.8 }), say('看那边，灯塔亮起来了。你说，它是不是在等什么人？'),
      pose({ angleX: 28, gazeX: .7 }, 'smile'), say('……怎么又看着我？我说的是窗外啦。'),
      pose({ angleY: 20, gazeY: .6 }, 'surprise'), say('啊，流星！这次我们都看见了，对不对？'),
      pose({ angleY: -16, angleZ: -8, gazeY: -.5 }, 'shy'), say('刚才的愿望……现在告诉你，会不会就不灵了？'),
      pose({ angleX: -10, angleZ: 6 }, 'wink'), say('那就先保密。你愿意留下来，陪我听完这一阵海风吗？'), cue('choice'),
    ], [
      { id: 'stay-here', text: '留下来，一起等灯塔再亮一次。', targetId: 'stay-ending', condition: null, effects: [{ variableId: 'stay', op: 'set', value: true }] },
      { id: 'walk-out', text: '出去走走，让海风替我们带路。', targetId: 'walk-ending', condition: null, effects: [] },
    ]),
    scene('stay-ending', '结局 · 把愿望留在这里', [pose({}, 'surprise'), say('真的？那我要把这个夜晚记住。'), pose({ angleX: 16, angleZ: 4 }, 'smile', 'greeting'), say('下次灯塔亮起来的时候，我们还坐在这里。说好了。'), say('窗边多了一把椅子。那个没有说出口的愿望，已经有了答案。', '')], [], true),
    scene('walk-ending', '结局 · 海风知道的方向', [cue('background', { assetId: 'station', duration: 1000 }), show(), pose({ angleX: -24, gazeX: -.5 }, 'shy'), say('好呀。这一次，就让我带路吧。'), pose({ angleX: 20, angleZ: 5 }, 'smile'), say('走慢一点。海边的故事，值得慢慢听。'), say('她回过头，发梢和流苏随着晚风轻轻摆动。故事走向了新的方向。', '')], [], true),
  ]
  p.startSceneId = p.scenes[0].id
  return p
}

export function shionDemo(project, model) {
  const p = upgradeProject(blankProject('月下听潮 · 汐音', project.id))
  p.assets = project.assets; p.models = [modelSummary(model)]
  p.description = '银紫长发与青玉月饰的汐音，在潮声里等一封迟来的信。原创正面站姿与独立绑定：呼吸、眨眼、视线、口型、转头、垂臂和丝绦摆动；两个结局。'
  p.cast = [{ id: 'shion', name: '汐音', portraitId: '', modelId: model.id, color: '#a9dfd5', expressions: [] }]
  p.variables = [{ id: 'listen', name: '听完这封信', kind: 'boolean', initial: false }]
  let n = 0
  const cue = (type, values = {}) => ({ id: 'shion-cue-' + ++n, type, ...values })
  const say = (text, speakerId = 'shion') => cue('say', { speakerId, text })
  const pose = (parameters = {}, expressionId = 'neutral', motionId = '') => cue('model', { characterId: 'shion', parameters, expressionId, motionId, idle: true })
  const show = () => cue('show', { characterId: 'shion', expressionId: '', x: 53, y: -4, scale: 1.14, opacity: 1, duration: 750 })
  const scene = (id, title, commands, choices = [], ending = false) => { const s = { id, title, commands, choices, ending, backgroundId: '', musicId: '', leftCharacterId: '', rightCharacterId: '', lines: [] }; syncLegacy(s); return s }
  p.scenes = [
    scene('moon-letter', '序章 · 灯塔寄来的信', [
      cue('background', { assetId: 'station', duration: 800 }), cue('music', { assetId: 'rain-theme', volume: .3, duration: 1000 }), show(),
      pose({}, 'neutral', 'greeting'), say('你来了。我叫汐音。今晚的潮水，比约好的时间早到了三分钟。'),
      pose({ angleX: -24, gazeX: -.65 }), say('看左边——灯塔一闪一闪的。那里有人替我保管着一封信。'),
      pose({ angleX: 24, gazeX: .65 }), say('再看看海的另一头。船影那么小，可我还是一眼就认出来了。'),
      pose({ angleY: 17, gazeY: .5 }, 'surprise'), say('啊……月亮从云后面出来了！你看，我的月牙发饰也亮起来了。'),
      pose({ angleY: -12, angleZ: 5, gazeY: -.3 }, 'shy'), say('其实，我今天并不只是来等那封信的。'),
      pose({ angleX: -8, angleZ: -4 }, 'wink'), say('别猜得那么快嘛。先陪我走一段，好不好？'),
      pose({ armSwingL: .8, elbowBendL: .35, armSwingR: .3 }), say('手放松一些。海风会从袖口经过，也会把头发和丝带轻轻托起来。'),
      pose({}, 'smile'), say('听。现在闭上眼睛，是不是更容易听见海浪了？'),
      pose({ angleX: 9 }, 'neutral'), say('信里说，只要有人愿意听完，错过的故事就还不算结束。你愿意吗？'), cue('choice'),
    ], [
      { id: 'read-letter', text: '我愿意。把那封信读给我听吧。', targetId: 'letter-ending', condition: null, effects: [{ variableId: 'listen', op: 'set', value: true }] },
      { id: 'follow-tide', text: '我们一起去灯塔，亲手取回它。', targetId: 'lighthouse-ending', condition: null, effects: [] },
    ]),
    scene('letter-ending', '结局 · 留在潮声里的名字', [
      pose({}, 'surprise'), say('真的？那我从第一行开始读。'),
      pose({ angleY: -9, gazeY: -.25 }), say('“致下一个陪我听海的人：如果你读到这里，请把我的名字留在潮声里。”'),
      pose({ angleX: -10, angleZ: 3 }, 'shy'), say('最后一行……是我刚刚补上去的。'),
      pose({}, 'smile', 'greeting'), say('谢谢你愿意留下来。明天的海，也一起听吧。'),
      say('信纸合拢，潮声还在继续。今晚，汐音等到的并不只有一封信。', ''),
    ], [], true),
    scene('lighthouse-ending', '结局 · 月光替我们带路', [
      cue('background', { assetId: 'observatory', duration: 1000 }), show(),
      pose({ angleX: 22, gazeX: .5 }), say('从这边走。灯塔就在长廊的尽头。'),
      pose({ angleX: -18, angleZ: 4, armSwingR: .65, elbowBendR: .3 }, 'shy'), say('你走慢一点……丝带被海风缠住了。'),
      pose({}, 'smile', 'greeting'), say('好了。现在，月光会替我们带路。'),
      say('她回过头，银紫色的发梢在夜色里晃了晃。远处的灯塔，又亮了一次。', ''),
    ], [], true),
  ]
  p.startSceneId = p.scenes[0].id
  return p
}
