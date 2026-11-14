import { createRectArtMesh } from './vendor/standrig/runtime.js'

const generatedBy = 'semantic-rig-v2'
// Only our own generated bindings may be refreshed. Hand authored bindings win.
function generated(list, binding, match) {
  const at = list.findIndex(match)
  if (at < 0) list.push({ ...binding, generatedBy })
  else if (list[at].generatedBy === generatedBy) list[at] = { ...binding, generatedBy }
}
const keys = pairs => pairs.map(([input,value]) => ({input,value}))

export function rigSemanticParts(model, origin) {
  const r=model.rig, w=r.stage.width, h=r.stage.height
  for (const p of r.parts) {
    if (p.locked) continue
    const a=r.assets.find(a=>a.id===p.assetId); if (!a) continue
    const body=['torso','clothing','accessory'].includes(p.role), eye=p.role?.startsWith('eye-'), closed=p.role?.endsWith('-closed'), mouth=p.role?.startsWith('mouth')
    p.deformerId ||= body ? 'body-root' : 'head-root'
    p.artMesh ||= createRectArtMesh(a.width,a.height,{preset:'face-feature',columns:6,rows:6})
    p.bindings ||= []; p.artMesh.bindings ||= []; p.artMesh.multiBindings ||= []
    const transform=(parameter,property,pairs,extra={})=>generated(p.bindings,{parameter,property,keys:keys(pairs),...extra},b=>b.parameter===parameter&&b.property===property)
    const mesh=(parameter,offset)=>generated(p.artMesh.bindings,{parameter,keys:[-1,0,1].map(input=>({input,offsets:p.artMesh.vertices.map(v=>({vertexId:v.id,...offset(v,input)}))}))},b=>b.parameter===parameter)
    const paired=eye&&!closed?r.parts.some(x=>x.role===p.role+'-closed'&&x.visible):p.role==='mouth'&&r.parts.some(x=>x.role==='mouth-open'&&x.visible)
    if((eye&&!closed)||p.role==='mouth'){const parameter=eye?(p.role==='eye-left'?'ParamEyeLOpen':'ParamEyeROpen'):'ParamMouthOpen';p.bindings=p.bindings.filter(b=>b.generatedBy!==generatedBy||b.parameter!==parameter||b.property!==(paired?'scaleY':'opacity'))}
    if (eye) {
      const parameter=p.role.startsWith('eye-left')?'ParamEyeLOpen':'ParamEyeROpen'
      if (closed) transform(parameter,'opacity',[[0,1],[.12,1],[.3,0],[1,0]],{composition:'multiply'})
      else if (paired) {
        transform(parameter,'opacity',[[0,0],[.12,0],[.3,1],[1,1]],{composition:'multiply'})
        generated(p.artMesh.bindings,{parameter,keys:[0,.5,1].map(input=>({input,offsets:p.artMesh.vertices.map(v=>({vertexId:v.id,x:0,y:(a.height*.5-v.y)*(1-input)*.9*Math.sin(Math.PI*v.u)}))}))},b=>b.parameter===parameter)
      }
      else transform(parameter,'scaleY',[[0,-.88],[1,0]])
      if (!closed) {
        mesh('ParamEyeBallX',(v,i)=>({x:i*a.width*.055*Math.sin(Math.PI*v.u)*Math.sin(Math.PI*v.v),y:0}))
        mesh('ParamEyeBallY',(v,i)=>({x:0,y:i*a.height*.07*Math.sin(Math.PI*v.u)*Math.sin(Math.PI*v.v)}))
      }
    }
    if (mouth) {
      if (p.role==='mouth-open') transform('ParamMouthOpen','opacity',[[0,0],[.2,.3],[.55,1],[1,1]],{composition:'multiply'})
      else if (paired) transform('ParamMouthOpen','opacity',[[0,1],[.2,.7],[.55,0],[1,0]],{composition:'multiply'})
      else transform('ParamMouthOpen','scaleY',[[0,0],[1,.35]])
      transform('ParamMouthForm','scaleX',[[-1,-.12],[0,0],[1,.08]])
      transform('ParamMouthSmile','rotation',[[-1,-2],[0,0],[1,2]])
    }
    if (p.role?.startsWith('brow-')) {
      transform(p.role==='brow-left'?'ParamBrowLY':'ParamBrowRY','y',[[-1,-h*.004],[0,0],[1,h*.004]])
      transform(p.role==='brow-left'?'ParamBrowLAngle':'ParamBrowRAngle','rotation',[[-1,-8],[0,0],[1,8]])
    }
    if (!body) {
      const keyforms=[]
      for (const x of [-30,0,30]) for (const y of [-30,0,30]) keyforms.push({inputs:{ParamAngleX:x,ParamAngleY:y},offsets:p.artMesh.vertices.map(v=>{
        const px=p.transform.x+(v.x-a.width*p.transform.pivotX)*p.transform.scaleX, py=p.transform.y+(v.y-a.height*p.transform.pivotY)*p.transform.scaleY
        const profile=Math.max(.15,1-((py-origin.y)/(h*.28))**2), depth=p.role==='face'?profile:p.role.startsWith('hair')?.55:1
        return {vertexId:v.id,x:(x/30)*(w*.016*depth-(px-origin.x)*.035),y:(y/30)*(h*.009*depth-(py-origin.y)*.018)}
      })})
      generated(p.artMesh.multiBindings,{parameters:['ParamAngleX','ParamAngleY'],interpolation:'linear',keyforms},b=>b.parameters.includes('ParamAngleX')&&b.parameters.includes('ParamAngleY'))
    }
    if (p.role?.startsWith('hair') || p.role==='accessory') {
      const parameter=p.role==='hair-front'?'ParamHairFront':p.role==='hair-back'?'ParamHairBack':'ParamRibbon'
      if (!r.parameters.some(x=>x.id===parameter)) r.parameters.push({id:parameter,label:parameter,min:-1,max:1,default:0,step:.01})
      // The top row is fixed; the lower rows carry progressively more movement.
      mesh(parameter,(v,i)=>({x:i*a.width*(p.role==='accessory'?.009:.025)*v.v**2*(.6+.4*Math.cos(v.u*Math.PI*2)),y:i*a.height*.003*v.v**2*Math.sin(v.u*Math.PI*2)}))
      if (!r.physics.chains.some(c=>c.targetPartIds.includes(p.id))) r.physics.chains.push({id:crypto.randomUUID(),name:p.name+'局部摆动',generatedBy,enabled:true,targetPartIds:[p.id],sourceParameters:[{parameter:'ParamAngleX',scale:.025},{parameter:'ParamAngleZ',scale:.015}],stiffness:p.role==='hair-back'?14:22,damping:6,mass:1,gravity:0,wind:.22,output:{property:'rotation',scale:0},parameterOutput:{parameter,scale:1,min:-1,max:1}})
    }
  }
}
