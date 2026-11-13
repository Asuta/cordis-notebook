import { el, input, select, field, button, area } from './ui.js'
import { easings, weatherNames, dialogueModes, filterPresets, filterDefaults, cameraDefaults } from './effects.js'

const choices = values => Object.entries(values).map(([value, label]) => ({ value, label }))
const toggle = (label, checked, action) => { const n = el('input'); n.type = 'checkbox'; n.checked = checked; n.addEventListener('change', () => action(n.checked)); return el('label', 'novel-inline-toggle', n, label) }
export function effectsInspector({ p, c, patch, mutate, openLibrary }) {
  const root = el('div', 'novel-effects-inspector')
  const number = (label, key, min, max, step = .1) => { const n = input(c[key], v => { if (v.trim() && Number.isFinite(Number(v))) patch(key, Math.max(min, Math.min(max, Number(v)))) }); n.type = 'number'; n.min = min; n.max = max; n.step = step; return field(label, n) }
  const grid = (...fields) => el('div', 'novel-property-grid', ...fields)
  if (c.type === 'camera') {
    root.append(grid(number('背景水平偏移 %', 'x', -50, 50), number('背景垂直偏移 %', 'y', -50, 50), number('背景缩放', 'scale', .5, 3, .05), number('背景旋转 °', 'rotation', -180, 180, 1)), number('镜头时长 ms', 'duration', 0, 30000, 100), field('镜头缓动', select(c.easing, choices(easings), v => patch('easing', v))), button('重置镜头', () => mutate(s => Object.assign(s.commands.find(x => x.id === c.id), cameraDefaults()), true), 'novel-secondary'))
  }
  if (c.type === 'shake') root.append(grid(number('震动强度 %', 'strength', 0, 5), number('震动时长 ms', 'duration', 0, 10000, 100), number('每秒震动次数', 'frequency', 1, 30, 1)), el('p', 'novel-preview-note', '只震动画面层；编辑器请开启演出预览。读档和回退不重播一次性震动。'))
  if (c.type === 'weather') root.append(field('天气类型', select(c.effect, choices(weatherNames), v => patch('effect', v))), grid(number('天气密度', 'intensity', 0, 1, .05), number('天气速度', 'speed', .1, 3)), el('p', 'novel-preview-note', '天气持续到下一条天气指令；选择关闭天气可清除。'))
  if (c.type === 'filter') {
    root.append(field('滤镜预设', select('', [{ value: '', label: '选择预设…' }, ...Object.entries(filterPresets).map(([value, f]) => ({ value, label: f.name }))], id => { if (filterPresets[id]) mutate(s => Object.assign(s.commands.find(x => x.id === c.id), filterDefaults(), filterPresets[id].values), true) })))
    root.append(grid(number('亮度', 'brightness', 0, 3), number('对比度', 'contrast', 0, 3), number('饱和度', 'saturation', 0, 3), number('黑白程度', 'grayscale', 0, 1), number('怀旧程度', 'sepia', 0, 1), number('模糊 px', 'blur', 0, 20, .5), number('色相 °', 'hue', -180, 180, 1), number('滤镜过渡 ms', 'duration', 0, 30000, 100)))
  }
  if (c.type === 'animate') {
    root.append(field('动画目标', select(c.target, [{value:'background',label:'背景'},{value:'stage',label:'整个场景（不含文字）'},{value:'character',label:'指定角色'}], v => patch('target', v, true))))
    if (c.target === 'character') root.append(field('动画角色', select(c.characterId, [{ value: '', label: '选择角色' }, ...p.cast.map(x => ({value:x.id,label:x.name}))], v => patch('characterId', v))))
    root.append(field('使用动画', select(c.animationId, [{value:'',label:'停止该目标的动画'}, ...(p.animations || []).map(a => ({value:a.id,label:a.name}))], v => patch('animationId', v))), button('编辑动画库', openLibrary, 'novel-secondary'), el('p', 'novel-preview-note', '动画位移、缩放和旋转相对于当前站位 / 镜头叠加；新动画替换同一目标的旧动画。'))
  }
  if (c.type === 'say') {
    const defaults = { color: '#eee8df', size: 100, align: c.mode === 'monologue' || c.mode === 'subtitle' ? 'center' : 'left', bold: false, italic: false }
    const setStyle = (key, value) => patch('textStyle', { ...defaults, ...c.textStyle, [key]: value })
    const color = input(c.textStyle?.color || defaults.color, v => setStyle('color', v)); color.type = 'color'
    const size = input(c.textStyle?.size || 100, v => { if (Number.isFinite(Number(v))) setStyle('size', Math.max(70, Math.min(180, Number(v)))) }); size.type = 'number'; size.min = 70; size.max = 180
    root.append(field('文字显示模式', select(c.mode || 'dialogue', choices(dialogueModes), v => patch('mode', v, true))), grid(field('文字颜色', color), field('字号 %', size)), field('文字对齐', select(c.textStyle?.align || defaults.align, [{value:'left',label:'左对齐'},{value:'center',label:'居中'},{value:'right',label:'右对齐'}], v => setStyle('align', v))), toggle('整句加粗', !!c.textStyle?.bold, v => setStyle('bold', v)), toggle('整句斜体', !!c.textStyle?.italic, v => setStyle('italic', v)))
    root.append(toggle('分段设置颜色、强调和注音', !!c.segments, enabled => patch('segments', enabled ? [{ text: c.text, color: '#eee8df', bold: false, italic: false, ruby: '' }] : undefined, true)))
    const editSegment = (index, key, value) => mutate(s => { const cmd = s.commands.find(x => x.id === c.id); cmd.segments[index][key] = value; cmd.text = cmd.segments.map(x => x.text).join('') })
    for (const [i, s] of (c.segments || []).entries()) {
      const color = input(s.color, v => editSegment(i, 'color', v)); color.type = 'color'
      root.append(el('div', 'novel-segment', field('分段 ' + (i + 1) + ' 文字', area(s.text, v => editSegment(i, 'text', v))), field('分段颜色', color), field('注音（可留空）', input(s.ruby, v => editSegment(i, 'ruby', v.slice(0, 100)))), toggle('加粗', s.bold, v => editSegment(i, 'bold', v)), toggle('斜体', s.italic, v => editSegment(i, 'italic', v)), button('移除此段', () => mutate(scene => { const cmd = scene.commands.find(x => x.id === c.id); cmd.segments.splice(i, 1); cmd.text = cmd.segments.map(x => x.text).join('') }, true), 'novel-inline-action')))
    }
    if (c.segments && c.segments.length < 60) root.append(button('＋ 添加文字分段', () => mutate(s => { const cmd = s.commands.find(x => x.id === c.id); cmd.segments.push({text:'',color:'#eee8df',bold:false,italic:false,ruby:''}) }, true), 'novel-secondary'))
  }
  return root
}
