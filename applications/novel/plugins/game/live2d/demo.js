import { blankProject, upgradeProject, syncLegacy } from '../model.js'
import { modelSummary } from './document.js'

export function avatarDemo(id, assets, model) {
  const p = upgradeProject(blankProject('寄给明天的第七封信', id))
  p.description = '动态角色制作示例：单张立绘经 AI 拆层与补画，演示呼吸、眨眼、转头、视线、表情、点头与发丝物理。两个结局，可进入角色工作室继续编辑。'
  p.assets = assets; p.models = [modelSummary(model)]
  p.cast = [{ id: 'silver', name: '银蓝', portraitId: model.sourceAssetId, modelId: model.id, color: '#bcdcf4', expressions: [] }]
  p.variables = [{ id: 'stay', name: '选择留下', kind: 'boolean', initial: false }]
  let serial = 0
  const command = (type, rest) => ({ id: 'avatar-cue-' + ++serial, type, ...rest })
  const say = (text, speakerId = 'silver') => command('say', { speakerId, text })
  const pose = (expressionId = '', motionId = '', parameters = {}) => command('model', { characterId: 'silver', expressionId, motionId, parameters, idle: true })
  const scene = (id, title, commands, choices = [], ending = false) => { const s = { id, title, backgroundId: '', musicId: '', leftCharacterId: '', rightCharacterId: '', lines: [], commands, choices, ending }; syncLegacy(s); return s }
  const show = () => command('show', { characterId: 'silver', expressionId: '', x: 57, y: -2, scale: 1, opacity: 1, duration: 800 })
  p.scenes = [
    scene('seventh-letter', '零点观测室', [
      command('background', { assetId: 'observatory', duration: 800 }), command('music', { assetId: 'rain-theme', volume: .4, duration: 1200 }), show(),
      say('观测室的门没有上锁。银蓝坐在窗边，信纸被海风掀起一角。', ''), pose('smile', 'greeting'),
      say('你来了。我还以为，今晚只能对着第七颗星星练习这句话。'),
      pose('', '', { ParamAngleX: -15, ParamEyeBallX: -1, ParamAngleZ: -4 }),
      say('别盯着我看……我在确认窗外那盏灯是不是又坏了。'),
      pose('surprise', '', { ParamAngleY: 10, ParamEyeBallY: -.6 }),
      say('等等。你听见了吗？信标的声音，和六年前一模一样。'),
      command('sound', { assetId: 'signal-cue', volume: .5 }), pose('shy', 'greeting'),
      say('这封信已经写到第七遍了。前六遍都在说再见，这一遍……我想换个开头。'),
      pose('smile', '', { ParamAngleX: 10, ParamEyeBallX: .5 }),
      say('假如明天还会下雨，你愿意和我一起，把屋顶的那台收音机修好吗？'), command('choice', {}),
    ], [
      { id: 'repair-together', text: '留下来。明天的雨，我们一起听。', targetId: 'tomorrow', condition: null, effects: [{ variableId: 'stay', op: 'set', value: true }] },
      { id: 'send-letter', text: '先把信寄出去吧，我会在下一站等你。', targetId: 'next-station', condition: null, effects: [] },
    ]),
    scene('tomorrow', '结局 · 信的第一行', [command('background', { assetId: 'observatory', duration: 600 }), show(), pose('surprise', 'greeting'), say('……真的？那我现在就把工具箱找出来。'), pose('smile', '', { ParamAngleX: 6, ParamAngleZ: 5 }), say('信的第一行终于写好了。不是“好久不见”，是“明天见”。'), say('窗外的信标转过海面。她没有急着回头，只是把另一把椅子轻轻挪到身边。', '')], [], true),
    scene('next-station', '结局 · 下一站来信', [command('background', { assetId: 'station', duration: 1000 }), show(), pose('shy', 'greeting'), say('好。我会把第七封信寄给下一站的你。'), pose('smile', '', { ParamAngleX: -8, ParamEyeBallX: -.4 }), say('这次我会记得写回信地址。所以……不许装作没有收到。'), say('列车驶离时，银蓝的发梢被晚风轻轻吹起。信封上的邮票，是一枚还没有升起的太阳。', '')], [], true),
  ]
  p.startSceneId = p.scenes[0].id
  return p
}
