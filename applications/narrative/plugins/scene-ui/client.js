import { builtinTypes } from './types.js'
import { mountScene } from './renderer.js'
export default function(ctx,sdk){
  const engine=ctx.narrative,scene=ctx.sceneRuntime,ui=ctx.narrativeUI
  for(const type of builtinTypes())scene.register(ctx,type)
  scene.provide(ctx,'navigation',{open:id=>scene.switchScene(id)})
  const views={mount:(host,options={})=>mountScene(host,{scene,engine,ui,...options})}
  sdk.provide('sceneViews',views)
  ui.registerSurface(ctx,{id:'scene.player',order:0,mount(host){host.classList.add('scene-player');const view=views.mount(host);return()=>view.dispose()}})
}
