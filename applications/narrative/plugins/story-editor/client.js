import { mountEditor } from './editor.js'
export default function(ctx, sdk) {
  const engine = ctx.narrative, ui = ctx.narrativeUI
  ui.registerPanel(ctx, {id:'novel.editor', label:'剧情与对白', icon:'✎', order:15, render:host => mountEditor(host,{engine,sdk,ui})})
  ui.registerToolbar(ctx, {id:'story-edit', label:'剧情与对白', icon:'✎', place:'header', run:() => ui.navigate('novel.editor')})
  ui.registerInspector?.(ctx,{id:'story-source',types:['story-flow'],render(host,{object,sceneId}){
    const s=(engine.project.stories||[]).find(s=>s.id===object.props?.storyId),note=document.createElement('p'),button=document.createElement('button')
    note.className='ne-muted';note.textContent=s?s.name+' · '+s.nodes.length+' 个章节 · 各实例独立保存进度':'先在对象参数中绑定剧情资源。'
    button.type='button';button.className='ne-button ne-primary';button.textContent=s?'编辑这份剧情':'创建剧情资源'
    button.addEventListener('click',()=>{engine.select({storyId:s?.id||'',nodeId:s?.startNodeId||'',flowObjectId:object.id,flowSceneId:sceneId});ui.navigate('novel.editor').catch(e=>sdk.toast(e.message))})
    host.append(note,button)
  }})

}
