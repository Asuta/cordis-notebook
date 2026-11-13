import { RigRuntime } from './vendor/standrig/runtime.js'
import { defaults, sampleMotion } from './document.js'

export function resolvedRig(model,assetUrl) { const rig=structuredClone(model.rig);for(const a of rig.assets)a.src=assetUrl(a.src.slice(6));return rig }
export function createAvatarRenderer(canvas,assetUrl) {
  let runtime=null,model=null,token=0,disposed=false,signature='',error=''
  return {
    get runtime(){return runtime},get model(){return model},get error(){return error},
    async setModel(next) {
      const seq=++token;model=next;error='';const rig=resolvedRig(next,assetUrl),key=JSON.stringify(rig.assets)
      if(runtime&&key===signature){runtime.rig=rig;runtime.resetPhysics();return}
      const candidate=new RigRuntime(rig);try{await candidate.loadAssets();if(disposed||seq!==token){candidate.dispose();return}runtime?.dispose();runtime=candidate;signature=key}catch(e){candidate.dispose();if(seq===token)error='模型纹理加载失败：'+e.message;throw e}
    },
    render(parameters={},options={}) { if(runtime&&!disposed){runtime.rig.physics.enabled=model.rig.physics.enabled&&!options.freezePhysics;runtime.render(canvas,{...defaults(model),...parameters},{transparent:true,fitPadding:0,...options})} },
    reset(){runtime?.resetPhysics()},dispose(){disposed=true;token++;runtime?.dispose();runtime=null},
  }
}
export function actorParameters(model,state={},elapsed=0,speech=0) {
  const values={...defaults(model)}
  if(state.idle!==false){values.ParamBreath=.5+.5*Math.sin(elapsed/850);values.ParamBodyAngleX=Math.sin(elapsed/1700)*2;const phase=elapsed%4100,blink=phase>3900?Math.abs(phase-4000)/100:1;values.ParamEyeLOpen=values.ParamEyeROpen=blink;values.ParamAngleZ=Math.sin(elapsed/2300)*1.5}
  const expression=model.expressions.find(e=>e.id===state.expressionId);if(expression)Object.assign(values,expression.values)
  const motion=model.motions.find(m=>m.id===state.motionId);if(motion)Object.assign(values,sampleMotion(motion,elapsed))
  if(speech>0)values.ParamMouthOpen=Math.min(1,speech)
  Object.assign(values,state.parameters||{})
  for(const p of model.rig.parameters)values[p.id]=Math.max(p.min,Math.min(p.max,values[p.id]??p.default))
  return values
}
const audioNodes=new WeakMap()
export function audioLevel(audio) {
  if(audioNodes.has(audio))return audioNodes.get(audio)
  const Audio=globalThis.AudioContext||globalThis.webkitAudioContext;if(!Audio)return ()=>0
  try{const context=new Audio(),source=context.createMediaElementSource(audio),analyser=context.createAnalyser();analyser.fftSize=256;source.connect(analyser);analyser.connect(context.destination);const bytes=new Uint8Array(analyser.fftSize);const sample=()=>{if(context.state==='suspended')void context.resume().catch(()=>{});analyser.getByteTimeDomainData(bytes);let n=0;for(const v of bytes)n+=(v-128)**2;return Math.min(1,Math.sqrt(n/bytes.length)/22)};sample.dispose=()=>{source.disconnect();analyser.disconnect();void context.close()};audioNodes.set(audio,sample);return sample}catch{return ()=>0}
}
