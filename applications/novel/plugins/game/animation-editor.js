import { el, input, select, field, button, heading, uid } from './ui.js'
import { animationPresets, easings, frameDefaults } from './effects.js'
import { previewState } from './engine.js'
import { createStage } from './stage.js'

export function animationEditor(p, view, update, assetUrl) {
  const root = el('section', 'novel-animation-library'), controls = el('div'), preview = el('div'), stage = createStage(p, assetUrl)
  view.disposePreview = () => stage.dispose()
  const list = p.animations || []
  if (!list.some(a => a.id === view.animationId)) view.animationId = list[0]?.id
  const selected = () => p.animations?.find(a => a.id === view.animationId)
  let playing = false, nonce = 0, target = view.animationTarget || 'background'
  const refresh = () => {
    const scene = p.scenes.find(s => s.id === view.sceneId) || p.scenes[0], command = scene.commands.find(c => c.id === view.commandId) || scene.commands.find(c => c.type === 'say') || scene.commands[0]
    const state = previewState(p, scene.id, command?.id), a = selected()
    state.current = state.lastSay = null
    if (view.animationBackgroundId) state.stage.backgroundId = view.animationBackgroundId
    state.stage.animations = {}
    if (a) {
      const character = p.cast.find(c => c.id === view.animationCharacterId) || p.cast[0]
      const characterId = character?.id || '', key = target === 'character' ? 'character:' + characterId : target
      if (target === 'character' && !state.stage.portraits[characterId]?.visible && characterId) state.stage.portraits[characterId] = { characterId, portraitId:character.portraitId, visible:true,x:50,y:0,scale:1,opacity:1,duration:0 }
      state.stage.animations[key] = {target,characterId,animation:structuredClone(a),nonce}
    }
    stage.render(state, {instant:!playing,showLastSay:true})
  }
  view.refreshPreview = refresh
  const edit = (fn, rerender = false) => update(project => fn(project.animations.find(a => a.id === view.animationId)), rerender)
  const number = (label, value, min, max, step, action) => { const n = input(value, v => { if (v.trim() && Number.isFinite(Number(v))) action(Math.max(min, Math.min(max, Number(v)))) }); n.type='number'; n.min=min; n.max=max; n.step=step; return field(label,n) }
  root.append(heading('关键帧动画库', '动画可在多个场景和角色上复用'))
  const preset = select(animationPresets[0].id, animationPresets.map(a => ({value:a.id,label:a.name})), () => {})
  controls.append(el('div', 'novel-control-row', preset, button('＋ 从预设创建动画', () => { if(list.length>=60)return window.alert('动画库最多保留 60 个动画'); const a=structuredClone(animationPresets.find(a=>a.id===preset.value)); a.id=uid(); view.animationId=a.id; update(project=>{project.animations ||= [];project.animations.push(a)},true) },'novel-primary')))
  for (const a of list) controls.append(button(a.name, () => {view.animationId=a.id;update(()=>{},true,false)}, 'novel-secondary ' + (a.id===view.animationId?'active':'')))
  const a = selected()
  if (a) {
    controls.append(field('动画名称', input(a.name, v => edit(a=>{a.name=v.trim()||'未命名动画'}))), el('div','novel-property-grid', number('动画时长 ms',a.duration,16,30000,100,v=>edit(a=>{a.duration=v})),number('播放次数（0 为循环）',a.iterations,0,20,1,v=>edit(a=>{a.iterations=Math.round(v)}))))
    for (const [i,f] of a.keyframes.entries()) {
      const patch = (key,value) => edit(a=>{a.keyframes[i][key]=value})
      const first=i===0,last=i===a.keyframes.length-1
      const time = number('时间 %',f.at*100,first?0:a.keyframes[i-1].at*100+.01,last?100:a.keyframes[i+1].at*100-.01,.1,v=>patch('at',v/100)); time.querySelector('input').disabled=first||last
      controls.append(el('div','novel-keyframe-row', el('div','novel-keyframe-caption','关键帧 '+(i+1),...(!first&&!last?[button('移除此帧',()=>edit(a=>a.keyframes.splice(i,1),true),'novel-icon')]:[])),time,number('水平偏移 %',f.x,-100,100,.1,v=>patch('x',v)),number('垂直偏移 %',f.y,-100,100,.1,v=>patch('y',v)),number('缩放',f.scale,.1,3,.01,v=>patch('scale',v)),number('旋转 °',f.rotation,-360,360,1,v=>patch('rotation',v)),number('透明度',f.opacity,0,1,.05,v=>patch('opacity',v)),field('到下一帧的缓动',select(f.easing,Object.entries(easings).map(([value,label])=>({value,label})),v=>patch('easing',v)))))
    }
    if(a.keyframes.length<32) controls.append(button('＋ 插入关键帧',()=>edit(a=>{let at=1;for(let i=2;i<a.keyframes.length;i++)if(a.keyframes[i].at-a.keyframes[i-1].at>a.keyframes[at].at-a.keyframes[at-1].at)at=i;const left=a.keyframes[at-1],right=a.keyframes[at];a.keyframes.splice(at,0,{...frameDefaults(),at:(left.at+right.at)/2,x:(left.x+right.x)/2,y:(left.y+right.y)/2,scale:(left.scale+right.scale)/2,rotation:(left.rotation+right.rotation)/2,opacity:(left.opacity+right.opacity)/2})},true),'novel-secondary'))
    controls.append(button('复制动画',()=>{const copy=structuredClone(a);copy.id=uid();copy.name=(copy.name+' 副本').slice(0,60);view.animationId=copy.id;update(p=>p.animations.push(copy),true)},'novel-secondary'),button('删除此动画',()=>{if(p.scenes.some(s=>s.commands.some(c=>c.type==='animate'&&c.animationId===a.id)))return window.alert('此动画仍被剧情引用，请先更换或停止对应的动画指令。');update(p=>{p.animations=p.animations.filter(x=>x.id!==a.id)},true)},'novel-inline-action'))
  } else controls.append(el('p','novel-preview-note','先从上方预设创建动画，再调整关键帧。'))
  preview.append(heading('动画预览','偏移和缩放相对于当前画面'), el('div', 'novel-animation-preview-controls',
    field('预览背景', select(view.animationBackgroundId || '', [{value:'',label:'当前场景背景'},...p.assets.filter(a=>a.kind==='image').map(a=>({value:a.id,label:a.name}))], value=>{view.animationBackgroundId=value;nonce++;refresh()})),
    field('预览角色', select(view.animationCharacterId || p.cast[0]?.id || '', p.cast.map(c=>({value:c.id,label:c.name})), value=>{view.animationCharacterId=value;nonce++;refresh()})),
    field('预览目标',select(target,[{value:'background',label:'背景'},{value:'stage',label:'整个场景'},{value:'character',label:'所选角色'}],v=>{target=v;view.animationTarget=v;nonce++;refresh()}))),
    el('div','novel-preview-actions',button('▶ 播放 / 重播',()=>{playing=true;nonce++;refresh()},'novel-primary'),button('停止并查看终帧',()=>{playing=false;refresh()},'novel-secondary')),stage.root,el('p','novel-preview-note','循环动画停止时显示第一帧；一次性动画显示终帧。新动画会替换同一目标上的动画。'))
  root.append(el('div','novel-animation-layout',controls,preview));refresh();return root
}
