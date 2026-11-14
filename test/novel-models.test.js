import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer } from 'node:http'
import { createHost } from '../server/server.js'
import { validateModel } from '../applications/novel/plugins/game/live2d/document.js'
import { packageBytes, importPackage } from '../applications/novel/plugins/game/package.js'

test('动态角色 HTTP：版本冲突、AI 阶段复用、取消重试、幂等采用与完整作品包往返', async t => {
  const dir=await mkdtemp(join(tmpdir(),'cordis-model-test-'));t.after(()=>rm(dir,{recursive:true,force:true}))
  const app=await createHost({port:0,dataDir:dir,locationRoot:dir,initialApplication:'novel'});t.after(()=>app.close())
  const base='http://127.0.0.1:'+app.server.address().port,headers={'Content-Type':'application/json','X-Application-Session':app.applications.session}
  const response=async(path,method='GET',body)=>{const r=await fetch(base+path,{method,headers,...(body===undefined?{}:{body:JSON.stringify(body)})});return{status:r.status,data:await r.json()}}
  const request=async(path,method,body)=>{const r=await response(path,method,body);if(r.status!==200)throw Error(r.data.message||r.data.error||'HTTP '+r.status);return r.data}
  const project=await request('/api/novel/avatar-demo','POST'),path='/api/novel/projects/'+project.id,summary=project.models[0],modelPath=path+'/models/'+summary.id
  const model=validateModel(await request(modelPath));assert.equal(model.rig.parts.length,13)
  const changed=structuredClone(model);changed.name='修改后的角色'
  const saved=await request(modelPath,'PUT',{expectedRevision:model.revision,model:changed});assert.equal(saved.model.revision,2)
  assert.equal((await response(modelPath,'PUT',{expectedRevision:1,model:changed})).status,409)
  assert.equal((await request(modelPath+'?revision=1')).name,model.name)
  const gen=model.generation
  const job=await request(path+'/model-jobs','POST',{sourceAssetId:model.sourceAssetId,name:'候选角色',segmentationAssetId:gen.segmentationAssetId,repairAssetId:gen.repairAssetId,featureAssetId:gen.featureAssetId})
  const waitJob=async(id,statuses)=>{const until=Date.now()+20000;while(Date.now()<until){const j=await request(path+'/model-jobs/'+id);if(statuses.includes(j.status))return j;await new Promise(r=>setTimeout(r,25))}throw Error('制作任务未完成')}
  const done=await waitJob(job.id,['completed','failed']);assert.equal(done.status,'completed',done.error)
  assert.ok(done.assets.some(a=>a.id===done.featureAssetId),'眼嘴补画应记录为任务阶段素材，供预览和重试复用')
  assert.equal((await request(path)).models.length,1,'候选不覆盖当前模型')
  const adopted=await Promise.all([request(path+'/model-jobs/'+job.id+'/adopt','POST',{}),request(path+'/model-jobs/'+job.id+'/adopt','POST',{})])
  assert.equal(adopted[0].model.id,adopted[1].model.id)
  const current=await request(path);assert.equal(current.models.length,2);assert.equal(new Set(current.assets.map(a=>a.id)).size,current.assets.length)
  const bad=await request(path+'/model-jobs','POST',{sourceAssetId:model.sourceAssetId,segmentationAssetId:'missing-mask'})
  assert.equal((await waitJob(bad.id,['failed'])).status,'failed')
  await request(path+'/model-jobs/'+bad.id+'/retry','POST',{});assert.equal((await waitJob(bad.id,['failed'])).status,'failed')
  let entered;const waiting=new Promise(r=>entered=r)
  const provider=createServer(req=>{req.resume();entered()});await new Promise(r=>provider.listen(0,'127.0.0.1',r));t.after(()=>{provider.closeAllConnections();return new Promise(r=>provider.close(r))})
  await request('/api/novel/model-provider','PUT',{baseUrl:'http://127.0.0.1:'+provider.address().port,model:'test-image',apiKey:'test-local-key'})
  const cancellation=await request(path+'/model-jobs','POST',{sourceAssetId:model.sourceAssetId,segmentationAssetId:gen.segmentationAssetId})
  await waiting
  const cancelled=await request(path+'/model-jobs/'+cancellation.id+'/cancel','POST',{});assert.equal(cancelled.status,'cancelled');assert.ok(cancelled.segmentationAssetId)
  assert.equal((await request(path)).models.length,2)
  const bytes=await packageBytes(current,async url=>{const r=await fetch(base+url,{headers});assert.equal(r.status,200);return new Uint8Array(await r.arrayBuffer())})
  const copy=await importPackage(new File([bytes],'copy.novel.zip'),request)
  assert.equal(copy.models.length,2);assert.notEqual(copy.cast[0].modelId,current.cast[0].modelId)
  const imported=validateModel(await request('/api/novel/projects/'+copy.id+'/models/'+copy.cast[0].modelId),new Set(copy.assets.map(a=>a.id)))
  assert.equal(imported.name,'修改后的角色');assert.equal(imported.rig.parts.length,13);assert.deepEqual(imported.expressions,model.expressions);assert.deepEqual(imported.motions,model.motions)
  assert.notEqual(imported.sourceAssetId,model.sourceAssetId);assert.ok(copy.assets.some(a=>a.id===imported.generation.segmentationAssetId));assert.ok(copy.assets.some(a=>a.id===imported.generation.featureAssetId));assert.notEqual(imported.generation.featureAssetId,model.generation.featureAssetId)
})
