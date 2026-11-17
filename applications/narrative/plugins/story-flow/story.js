// The story uses the existing project/runtime envelope, so save slots capture it
// together with scene objects. No player progress is written into author data.
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
export function installStory(owner, engine) {
  let locked = false, disposed = false
  owner.effect(() => () => { disposed = true })
  const valid = () => !disposed && engine.mode === "play" && engine.runtime && ["story", "ending"].includes(engine.scene().type)
  const choices = () => engine.scene().choices.filter(c => conditionMatches(c.condition, engine.runtime?.variables || {}))
  function line(node, index) {
    const text = node.lines[index] || {speaker:"", text:""}
    engine.transact(r => {
      r.lineIndex = index; r.text = {...text}; r.story = {awaiting: !node.lines.length && node.choices.length > 0}
      if (text.text) r.transcript = [...r.transcript, {id:crypto.randomUUID(), role:text.speaker ? "assistant" : "narrator", name:engine.project.characters.find(c => c.id === text.speaker)?.name || "旁白", text:text.text}].slice(-1000)
    })
  }
  async function exclusive(task) {
    if (locked || !valid()) return false
    locked = true
    try { return await task() } finally { locked = false }
  }
  async function advance() {
    return exclusive(async () => {
      const n = engine.scene(), r = engine.runtime
      if (r.ended) return false
      if (r.lineIndex + 1 < n.lines.length) { line(n, r.lineIndex + 1); return true }
      if (n.choices.length) {
        if (!choices().length) throw Error("没有满足条件的选项，请检查分支条件")
        engine.transact(r => { r.story = {awaiting:true} }); return true
      }
      if (n.type === "ending" || !n.next) { engine.transact(r => { r.ended = true }); return true }
      const next = engine.project.nodes.find(x => x.id === n.next)
      if (!next || !["story", "ending"].includes(next.type)) throw Error("后续剧情不存在或类型不支持")
      await engine.go(next.id); return true
    })
  }
  async function choose(id) {
    return exclusive(async () => {
      if (!engine.runtime.story?.awaiting || engine.runtime.ended) throw Error("请先读完当前对白")
      const choice = choices().find(c => c.id === id)
      if (!choice) throw Error("这个选项当前不可用")
      const variables = choiceResult(engine.project, engine.runtime, choice)
      engine.transact(r => { r.variables = variables; r.story = {awaiting:false}; r.transcript = [...r.transcript, {id:crypto.randomUUID(),role:"user",name:"我",text:choice.text}].slice(-1000) })
      await engine.go(choice.target); return true
    })
  }
  for (const [type,label] of [["story","预写剧情"],["ending","故事结局"]]) engine.registerNode(owner, {type,label,color:"#d2b88b",enter:n => line(n,0),advance})
  return {advance,choose,choices}
}
