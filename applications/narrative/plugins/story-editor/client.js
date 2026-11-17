import { mountEditor } from './editor.js'
export default function(ctx, sdk) {
  const engine = ctx.narrative, ui = ctx.narrativeUI
  ui.registerPanel(ctx, {id:'novel.editor', label:'剧情与对白', icon:'✎', order:15, render:host => mountEditor(host,{engine,sdk,ui})})
  ui.registerToolbar(ctx, {id:'story-edit', label:'剧情与对白', icon:'✎', place:'header', run:() => ui.navigate('novel.editor')})
}
