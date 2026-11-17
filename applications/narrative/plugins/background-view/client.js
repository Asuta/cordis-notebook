export default function(ctx) {
  ctx.sceneRuntime.register(ctx,{type:'background-view',label:'背景显示',plugin:'background-view',fields:{asset:{kind:'asset',label:'背景图片',default:''},fit:{kind:'string',label:'填充方式',default:'cover',options:['cover','contain']}},events:[],
    initial:p=>({background:p.asset||''}),methods:{present:{label:'设置背景',fields:{value:{kind:'json',label:'背景数据',required:true}},run(a,{value}){if(!value||typeof value.background!=='string')throw Error('背景数据需要 background 素材 ID');a.set({background:value.background})}}},
    mount(host,o,{scene,engine}){host.classList.add('background-view');const image=document.createElement('img');image.alt=o.name||'背景';image.style.objectFit=o.props?.fit||'cover';host.append(image);let previous;return{update(){const id=scene.runtime?.state(o.id)?.background??o.props?.asset??'';const url=engine.asset(id);if(url!==previous){previous=url;if(url)image.src=url;else image.removeAttribute('src')}image.hidden=!url},dispose(){image.remove()}}}
  })
}
