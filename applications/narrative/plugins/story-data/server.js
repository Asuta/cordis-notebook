import { storyFormat } from './model.js'
import { lastTrainProject } from './last-train.js'
export default function(ctx) {
  ctx.projectFormats.register(ctx,{...storyFormat,templates:{'last-train':lastTrainProject},summary:p=>({nodes:(p.stories||[]).reduce((n,s)=>n+s.nodes.length,0)})})
}
