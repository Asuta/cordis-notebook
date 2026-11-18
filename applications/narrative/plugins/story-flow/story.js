export function conditionMatches(condition, variables) {
  if (!condition) return true
  if ((condition.type || "variable") !== "variable") return false
  const actual = variables[condition.variable], expected = condition.value
  if (!Number.isFinite(actual)) return false
  return ({gte: actual >= expected, lte: actual <= expected, eq: actual === expected, gt: actual > expected, lt: actual < expected})[condition.op] === true
}
export function choiceResult(project, runtime, choice) {
  const variables = {...runtime.variables}
  for (const action of choice.actions) {
    const variable = project.variables.find(v => v.id === action.variable)
    if (!["add-variable", "set-variable"].includes(action.type) || !variable) throw Error("选项使用了未支持的动作或不存在的变量")
    const value = action.type === "add-variable" ? variables[variable.id] + action.value : action.value
    if (!Number.isFinite(value)) throw Error("选项数值无效")
    variables[variable.id] = Math.max(variable.min, Math.min(variable.max, value))
  }
  const target = project.nodes.find(n => n.id === choice.target)
  if (!target || !["story", "ending"].includes(target.type)) throw Error("选项没有连接到有效的剧情或结局")
  return variables
}
export function boundedHistory(rows){const result=[];let length=0;for(const row of [...rows].reverse()){length+=JSON.stringify(row).length;if(result.length>=250||length>160000)break;result.unshift(row)}return result}
export function initialStory(source, nodeId = source.startNodeId) {
  const node = source.nodes.find(n=>n.id===nodeId)
  if(!node || !['story','ending'].includes(node.type))throw Error('剧情起点不存在或类型不支持')
  return {storyId:source.id,started:false,nodeId,lineIndex:0,variables:Object.fromEntries(source.variables.map(v=>[v.id,v.initial])),stage:structuredClone(node.stage),text:{speaker:'',text:''},transcript:[],story:{awaiting:false},ended:false}
}
export function enterLine(source, state, nodeId, index, characters) {
  const node=source.nodes.find(n=>n.id===nodeId)
  if(!node || !['story','ending'].includes(node.type))throw Error('后续剧情不存在或类型不支持')
  const text=node.lines[index]||{speaker:'',text:''}
  return {...state,started:true,nodeId,lineIndex:index,lineVisit:crypto.randomUUID(),stage:structuredClone(node.stage),text:{...text},ended:false,story:{awaiting:!node.lines.length&&node.choices.length>0},
    transcript:boundedHistory(text.text?[...state.transcript,{id:crypto.randomUUID(),role:text.speaker?'assistant':'narrator',name:characters.find(c=>c.id===text.speaker)?.name||'旁白',text:text.text}]:state.transcript)}
}
export function restoreStory(state,source) {
  const n=source.nodes.find(n=>n.id===state.nodeId)
  if(state.storyId!==source.id||!n||!['story','ending'].includes(n.type)||!Number.isInteger(state.lineIndex)||state.lineIndex<0||state.lineIndex>=Math.max(1,n.lines.length)||typeof state.started!=='boolean'||typeof state.ended!=='boolean'||typeof state.story?.awaiting!=='boolean'||state.story.awaiting&&state.lineIndex!==Math.max(0,n.lines.length-1))throw Error('剧情实例存档位置无效')
  if(!state.variables||source.variables.some(v=>!Number.isFinite(state.variables[v.id])||state.variables[v.id]<v.min||state.variables[v.id]>v.max))throw Error('剧情实例存档变量无效')
  if(!Array.isArray(state.transcript)||state.transcript.length>1000||state.transcript.some(m=>typeof m?.name!=='string'||typeof m?.text!=='string'||m.text.length>8000)||typeof state.text?.text!=='string'||typeof state.text?.speaker!=='string')throw Error('剧情实例存档对白无效')
  return {...state,stage:structuredClone(n.stage),transcript:boundedHistory(state.transcript)}
}
