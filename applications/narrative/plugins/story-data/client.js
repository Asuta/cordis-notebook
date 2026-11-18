import { storyFormat } from './model.js'
import { builtInPrefabs } from './story-composition.js'
export default function(ctx,sdk) {
  const engine=ctx.narrative
  engine.registerProjectFormat(ctx,{...storyFormat,prefabs:p=>builtInPrefabs(p.stories?.[0]?.id||'')})
  sdk.provide('storyData',{list:()=>engine.project.stories||[]})
}
