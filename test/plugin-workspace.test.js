import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, writeFile, readFile, rm } from 'node:fs/promises'
import { resolve, join, dirname } from 'node:path'
import { pathToFileURL } from 'node:url'
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { Context, Service } from 'cordis'
import { discoverBuiltins, inside } from '../server/plugin-discovery.js'
import { buildPlugins } from '../scripts/plugin-builder.js'
import { createApp } from '../server/server.js'
import { exportPlugins } from '../scripts/export-plugins.js'
import { ClientPlugins } from '../client/host/plugin-host.js'

const json = value => JSON.stringify(value,null,2)
async function fixture(t) {
  const parent=resolve('work'); await mkdir(parent,{recursive:true})
  const root=await mkdtemp(join(parent,'workspace-test-')), plugins=join(root,'plugins')
  await mkdir(plugins)
  t.after(async()=>{ assert.ok(inside(parent,root)); await rm(root,{recursive:true,force:true}) })
  return {root,plugins}
}
async function plugin(directory,id,override={},files={}) {
  const folder=join(directory,id); await mkdir(folder,{recursive:true})
  const pkg={name:`@cordis-notebook/${id}`,version:'1.0.0',private:true,type:'module',dependencies:{},cordis:{
    schemaVersion:1,id,name:id,defaultEnabled:false,client:'client.js',
    requires:{server:[],client:[]},provides:{server:[],client:[]},public:['client.js'],
    build:[{type:'bundle',input:'client.js',output:'client.js',platform:'browser'}],...override,
  }}
  await writeFile(join(folder,'package.json'),json(pkg))
  for(const [name,source] of Object.entries({'client.js':'export default () => {}',...files})) {
    await mkdir(dirname(join(folder,name)),{recursive:true}); await writeFile(join(folder,name),source)
  }
  return {folder,pkg,save:()=>writeFile(join(folder,'package.json'),json(pkg))}
}

test('新增目录即可发现、构建、启停、恢复及扩展公开类型，扫描不执行后端',async t=>{
  const {root,plugins}=await fixture(t), guarded=['server/builtins.js','client/contracts/index.d.ts','scripts/build.js']
  const before=await Promise.all(guarded.map(path=>readFile(path,'utf8')))
  const sample=await plugin(plugins,'sample',{
    server:{entry:'server.js',export:'default'},requires:{server:['http'],client:[]},provides:{server:[],client:['sample']},
    public:['client.js','assets/icon.svg'],build:[
      {type:'bundle',input:'client.ts',output:'client.js',platform:'browser'},
      {type:'bundle',input:'server.js',output:'server.js',platform:'node'},
      {type:'copy',input:'assets/icon.svg',output:'assets/icon.svg'},
      {type:'copy',input:'private.json',output:'private.json'},
    ],
  },{
    'client.ts':"import type { ClientContext, ClientSDK } from '@cordis-notebook/host'; export const environment = process.env.NODE_ENV; export default function(ctx: ClientContext, sdk:ClientSDK) { sdk.provide('sample', { value: 42 }) }",
    'server.js':"globalThis.workspaceSampleImports=(globalThis.workspaceSampleImports||0)+1; export default function(ctx) { ctx.http.route(ctx, 'GET', /^\\/api\\/sample$/, () => ({ok:true})) }",
    'assets/icon.svg':'<svg xmlns="http://www.w3.org/2000/svg"/>','private.json':'{"private":true}',
  })
  sample.pkg.dependencies['@cordis-notebook/host']='workspace:*'
  sample.pkg.exports={'./client':{types:'./types/client.d.ts'}}; await sample.save()
  await mkdir(join(sample.folder,'types'))
  await writeFile(join(sample.folder,'types/client.d.ts'),"import type {} from '@cordis-notebook/host'; export interface Sample { value:number } declare module '@cordis-notebook/host' { interface ClientServices { sample:Sample } }")
  await writeFile(join(sample.folder,'check.ts'),"import type {} from '@cordis-notebook/sample/client'; import type { ClientContext } from '@cordis-notebook/host'; declare const ctx:ClientContext; const value:number=ctx.sample.value;\n// @ts-expect-error sample value is numeric\nconst bad:string=ctx.sample.value")
  await writeFile(join(root,'tsconfig.json'),json({compilerOptions:{noEmit:true,strict:true,module:'ESNext',moduleResolution:'Bundler',target:'ES2022',skipLibCheck:false},files:[join(sample.folder,'check.ts')]}))
  const require=createRequire(import.meta.url)
  const compiler=resolve(dirname(require.resolve('typescript/package.json')),'bin/tsc')
  const check=spawnSync(process.execPath,[compiler,'-p',join(root,'tsconfig.json')],{encoding:'utf8'})
  assert.equal(check.status,0,check.stdout+check.stderr)
  assert.equal((await discoverBuiltins(plugins)).length,1); assert.equal(globalThis.workspaceSampleImports,undefined)
  await buildPlugins(plugins); assert.equal(globalThis.workspaceSampleImports,undefined)
  const browserBundle = await import(pathToFileURL(join(sample.folder, 'dist/client.js')).href)
  assert.equal(browserBundle.environment, 'production')
  let app=await createApp({port:0,file:join(root,'data/notes.json'),pluginsDir:plugins})
  const clientRoot=new Context()
  try {
    const base=`http://127.0.0.1:${app.server.address().port}`
    assert.equal(globalThis.workspaceSampleImports,undefined)
    assert.equal((await fetch(base+'/api/sample')).status,404)
    await app.manager.toggle('sample',true)
    assert.equal(globalThis.workspaceSampleImports,1)
    assert.deepEqual(await (await fetch(base+'/api/sample')).json(),{ok:true})
    assert.equal((await fetch(base+'/builtin/sample/assets/icon.svg')).status,200)
    for(const path of ['server.js','private.json','package.json','types/client.d.ts','dist/server.js']) assert.equal((await fetch(base+'/builtin/sample/'+path)).status,404,path)
    const host=new ClientPlugins(clientRoot,{sdkFor:ctx=>({provide:(name,value)=>Object.assign(new Service(ctx,name),value)}),load:spec=>import(pathToFileURL(join(sample.folder,'dist',spec.client)))})
    await host.sync(app.manager.serialize().plugins); assert.equal(clientRoot.sample.value,42)
    await app.manager.toggle('sample',false); await host.sync(app.manager.serialize().plugins)
    assert.equal(clientRoot.sample,undefined); assert.equal((await fetch(base+'/api/sample')).status,404)
    await app.manager.toggle('sample',true)
    await app.close(); app=await createApp({port:0,file:join(root,'data/notes.json'),pluginsDir:plugins})
    assert.equal(app.manager.records.get('sample').state,'enabled')
    assert.deepEqual(await Promise.all(guarded.map(path=>readFile(path,'utf8'))),before)
  } finally { await clientRoot.fiber.dispose(); await app.close(); delete globalThis.workspaceSampleImports }
})

test('包依赖不自动启用服务；缺少服务等待，提供者启用后由 Cordis 激活',async t=>{
  const {root,plugins}=await fixture(t)
  const provider=await plugin(plugins,'provider',{server:{entry:'server.js',export:'default'},provides:{server:['counter'],client:[]},build:[{type:'bundle',input:'client.js',output:'client.js',platform:'browser'},{type:'bundle',input:'server.js',output:'server.js',platform:'node'}]}, {'server.js':"import {Service} from 'cordis'; export default ctx=> { new Service(ctx,'counter') }"})
  provider.pkg.dependencies.cordis='4.0.0-rc.10'; await provider.save()
  const consumer=await plugin(plugins,'consumer',{defaultEnabled:true,requires:{server:['counter'],client:[]}})
  consumer.pkg.dependencies[provider.pkg.name]='workspace:*'; await consumer.save()
  const packageOnly=await plugin(plugins,'package-only',{defaultEnabled:true})
  packageOnly.pkg.dependencies[provider.pkg.name]='workspace:*'; await packageOnly.save()
  await buildPlugins(plugins)
  const app=await createApp({port:0,file:join(root,'data/notes.json'),pluginsDir:plugins})
  try {
    assert.equal(app.manager.records.get('provider').enabled,false)
    assert.equal(app.manager.records.get('consumer').state,'waiting')
    assert.equal(app.manager.records.get('package-only').state,'enabled')
    await app.manager.toggle('provider',true); await app.manager.records.get('consumer').fiber
    assert.equal(app.manager.records.get('consumer').state,'enabled')
    await assert.rejects(app.manager.toggle('provider',false),/依赖/)
  } finally { await app.close() }
})

test('撤销插件源码后跳过残留产物并警告，构建和正式启动仍可用',async t=>{
  const {root,plugins}=await fixture(t)
  await plugin(plugins,'healthy',{defaultEnabled:true})
  const removed=await plugin(plugins,'removed')
  await buildPlugins(plugins)
  const artifact=join(removed.folder,'dist/client.js'), before=await readFile(artifact,'utf8')
  await rm(join(removed.folder,'package.json'))
  await rm(join(removed.folder,'client.js'))
  await mkdir(join(removed.folder,'node_modules'))
  for (const mode of ['build','development','runtime']) {
    const warnings=[]
    const entries=await discoverBuiltins(plugins,{mode,onWarning:message=>warnings.push(message)})
    assert.deepEqual(entries.map(entry=>entry.manifest.id),['healthy'])
    assert.equal(warnings.length,1)
    assert.ok(warnings[0].includes(removed.folder))
    assert.match(warnings[0],/缺少 package\.json.*已跳过/)
  }
  await buildPlugins(plugins)
  const app=await createApp({port:0,file:join(root,'data/notes.json'),pluginsDir:plugins})
  try {
    assert.equal(app.manager.records.get('healthy').state,'enabled')
    assert.equal(app.manager.records.has('removed'),false)
    assert.equal((await fetch(`http://127.0.0.1:${app.server.address().port}/api/plugins`)).status,200)
    assert.equal(await readFile(artifact,'utf8'),before,'跳过扫描不会删除残留文件')
  } finally { await app.close() }
})

test('缺少清单但仍有源码、空目录或损坏清单不能作为构建残留跳过',async t=>{
  for (const kind of ['source-file','source-directory','empty','dist-file','invalid-manifest']) {
    await t.test(kind,async t=>{
      const {plugins}=await fixture(t), folder=join(plugins,'broken')
      await mkdir(folder)
      if (kind!=='empty' && kind!=='dist-file') await mkdir(join(folder,'dist'))
      if (kind==='source-file') await writeFile(join(folder,'server.js'),'export default () => {}')
      if (kind==='source-directory') await mkdir(join(folder,'src'))
      if (kind==='dist-file') await writeFile(join(folder,'dist'),'not a directory')
      if (kind==='invalid-manifest') await writeFile(join(folder,'package.json'),'{ invalid JSON')
      for (const mode of ['build','development','runtime']) {
        const warnings=[]
        await assert.rejects(discoverBuiltins(plugins,{mode,onWarning:message=>warnings.push(message)}),/插件 broken 清单无效/)
        assert.deepEqual(warnings,[])
      }
    })
  }
})

test('无效清单、重复 ID、缺失入口和后端资源公开在发现阶段被拒绝',async t=>{
  const {plugins}=await fixture(t), item=await plugin(plugins,'invalid')
  const good=structuredClone(item.pkg)
  for(const [mutate,pattern] of [
    [m=>{m.schemaVersion=99},/schemaVersion/],
    [m=>{m.build[0].type='shell'},/构建方式/],
    [m=>{m.build[0].input='../outside.js'},/路径/],
    [m=>{m.build[0].input='missing.js'},/文件不存在/],
    [m=>{m.public.push('secret.js')},/公开资源/],
    [m=>{m.build[0].platform='node'},/公开资源/],
    [m=>{m.requires.client=['duplicate','duplicate']},/无重复/],
  ]) {
    item.pkg=structuredClone(good); mutate(item.pkg.cordis)
    await writeFile(join(item.folder,'package.json'),json(item.pkg))
    await assert.rejects(discoverBuiltins(plugins),pattern)
  }
  await writeFile(join(item.folder,'package.json'),json(good))
  const duplicate=await plugin(plugins,'duplicate')
  await writeFile(join(duplicate.folder,'package.json'),json(good))
  await assert.rejects(discoverBuiltins(plugins),/重复/)
})

test('后端构建接受有无 node: 前缀的内置模块，但不豁免同名 npm 子路径',async t=>{
  const {plugins}=await fixture(t)
  const item=await plugin(plugins,'node-builtins',{
    client:null, server:{entry:'server.js',export:'default'}, public:[],
    build:[{type:'bundle',input:'server.js',output:'server.js',platform:'node'}],
  },{'server.js':`import { readFile } from 'fs/promises'
    import { basename } from 'path'
    import { fileURLToPath } from 'node:url'
    export default async () => ({
      name: basename(fileURLToPath(import.meta.url)),
      content: await readFile(new URL('../sample.txt', import.meta.url), 'utf8'),
    })`})
  await writeFile(join(item.folder,'sample.txt'),'builtins work')
  await buildPlugins(plugins)
  const module=await import(pathToFileURL(join(item.folder,'dist/server.js')).href)
  assert.deepEqual(await module.default(),{name:'server.js',content:'builtins work'})
  await writeFile(join(item.folder,'server.js'),"import value from 'fs/not-a-builtin'; export default () => value")
  await assert.rejects(buildPlugins(plugins),/依赖未声明/)
})

for (const mode of ['live', 'restart']) test(`后端 ${mode} 配置确认、失败回滚、独立数据及重启恢复`, async t => {
  const {root,plugins}=await fixture(t)
  const item=await plugin(plugins,'configured',{
    client:null, defaultEnabled:true, server:{entry:'server.js',export:'default'}, public:[],
    requires:{server:['http'],client:[]}, provides:{server:['counter'],client:[]},
    settings:{mode,fields:{value:{type:'number',label:'值',default:1,integer:true,min:0,max:20}}},
    build:[{type:'bundle',input:'server.js',output:'server.js',platform:'node'}],
  },{'server.js':`import {Service} from 'cordis'
    import {writeFile,readFile} from 'node:fs/promises'
    import {join} from 'node:path'
    export default async (ctx,config,runtime) => {
      if(config.value===9) throw Error('拒绝配置')
      const service=Object.assign(new Service(ctx,'counter'),{value:config.value,dir:runtime.dataDir})
      const path=join(runtime.dataDir,'marker.txt')
      await writeFile(path,'preserved',{flag:'wx'}).catch(e=>{if(e.code!=='EEXIST')throw e})
      runtime.onConfig(next=>{service.value=next.value;if(next.value===9)throw Error('拒绝配置')})
      ctx.http.route(ctx,'GET',/^\\/counter$/,async()=>({value:service.value,marker:await readFile(path,'utf8')}))
    }`})
  item.pkg.dependencies.cordis='4.0.0-rc.10';await item.save()
  const consumer=await plugin(plugins,'consumer',{
    client:null,defaultEnabled:true,server:{entry:'server.js',export:'default'},public:[],
    requires:{server:['counter'],client:[]},provides:{server:['consumer'],client:[]},
    build:[{type:'bundle',input:'server.js',output:'server.js',platform:'node'}],
  },{'server.js':"import {Service} from 'cordis'; export default ctx=>{ Object.assign(new Service(ctx,'consumer'),{value:()=>ctx.counter.value}) }"})
  consumer.pkg.dependencies.cordis='4.0.0-rc.10';await consumer.save()
  await buildPlugins(plugins)
  let app=await createApp({port:0,dataDir:join(root,'data'),pluginsDir:plugins})
  const current=()=>app.manager.describe(app.manager.records.get('configured'))
  const begin=value=>app.manager.settings.begin('configured',{value},current().configRevision)
  const value=()=>app.ctx.consumer.value()
  try {
    assert.equal(value(),1)
    assert.equal(app.ctx.counter.dir,join(root,'data/plugin-data/configured'))
    let staged=await begin(2)
    assert.equal(staged.pendingConfig.backend,true)
    assert.equal(value(),2);assert.equal(current().config.value,1)
    await app.manager.settings.finish(staged.pendingConfig.token,false,'页面失败')
    assert.equal(value(),1)
    staged=await begin(3);await app.manager.settings.finish(staged.pendingConfig.token,true)
    assert.equal(value(),3);assert.equal(current().configRevision,1)
    await assert.rejects(begin(9),/拒绝配置/)
    assert.equal(value(),3);assert.equal(app.manager.settings.pending,null)
    staged=await begin(4)
    const persist=app.manager.settings.persist
    app.manager.settings.persist=async()=>{throw Error('磁盘失败')}
    await assert.rejects(app.manager.settings.finish(staged.pendingConfig.token,true),/磁盘失败/)
    app.manager.settings.persist=persist
    assert.equal(value(),3)
    staged=await begin(5);await app.manager.settings.cancel(staged.pendingConfig.token,'超时')
    assert.equal(value(),3)
    await begin(6);await app.close()
    app=await createApp({port:0,dataDir:join(root,'data'),pluginsDir:plugins})
    assert.equal(value(),3)
    const result=await fetch(`http://127.0.0.1:${app.server.address().port}/counter`).then(r=>r.json())
    assert.deepEqual(result,{value:3,marker:'preserved'})
    await app.manager.toggle('consumer',false);await app.manager.toggle('configured',false)
    await begin(7);await app.manager.toggle('configured',true)
    assert.equal(app.ctx.counter.value,7)
  } finally {await app.close()}
})

test('导出的插件不含源码或构建清单，仍可加载、启停、恢复且后端资源不公开',async t=>{
  const {root,plugins}=await fixture(t)
  const item=await plugin(plugins,'standalone',{
    defaultEnabled:true,server:{entry:'server.js',export:'default'},requires:{server:['http'],client:[]},
    category:{id:'tools',label:'工具'},icon:'Blocks',styles:['style.css'],public:['client.js','style.css'],
    build:[{type:'bundle',input:'client.js',output:'client.js',platform:'browser'},{type:'bundle',input:'server.js',output:'server.js',platform:'node'},{type:'copy',input:'style.css',output:'style.css'}],
  },{'style.css':'.standalone { color: red }','server.js':"export default ctx=>ctx.http.route(ctx,'GET',/^\\/standalone$/,()=>({ok:true}))"})
  item.pkg.dependencies['@cordis-notebook/host']='workspace:*';await item.save()
  await buildPlugins(plugins)
  const exported=await exportPlugins(join(root,'runtime'),plugins)
  assert.ok(inside(root,plugins))
  await rm(plugins,{recursive:true}) // This fixture is isolated; its runtime can no longer read source inputs.
  const pkg=JSON.parse(await readFile(join(exported,'standalone/package.json'),'utf8'))
  assert.equal(pkg.cordis.build,undefined);assert.deepEqual(pkg.dependencies,{})
  let app=await createApp({port:0,dataDir:join(root,'data'),pluginsDir:exported})
  try {
    const base=`http://127.0.0.1:${app.server.address().port}`
    assert.equal((await fetch(base+'/standalone')).status,200)
    assert.equal((await fetch(base+'/builtin/standalone/style.css')).status,200)
    for(const file of ['server.js','package.json','../package.json'])assert.equal((await fetch(base+'/builtin/standalone/'+file)).status,404)
    assert.deepEqual(app.manager.records.get('standalone').manifest.category,{id:'tools',label:'工具'})
    await app.manager.toggle('standalone',false);assert.equal((await fetch(base+'/standalone')).status,404)
    await app.close();app=await createApp({port:0,dataDir:join(root,'data'),pluginsDir:exported})
    assert.equal(app.manager.records.get('standalone').enabled,false)
    await app.manager.toggle('standalone',true)
    assert.equal((await fetch(`http://127.0.0.1:${app.server.address().port}/standalone`)).status,200)
  } finally {await app.close()}
})

test('非主题的纯后端互斥组可确认切换、恢复和保存选择', async t => {
  const {root, plugins} = await fixture(t)
  for (const id of ['engine-a', 'engine-b']) await plugin(plugins, id, {
    client: null, defaultEnabled: id === 'engine-a', server: {entry:'server.js', export:'default'}, public: [],
    category: {id:'engines', label:'引擎'}, icon:'Blocks', exclusiveGroup:'engine', groupLabel:'处理引擎',
    build:[{type:'bundle', input:'server.js', output:'server.js', platform:'node'}],
  }, {'server.js': 'export default () => {}'})
  await buildPlugins(plugins)
  let app = await createApp({port:0, dataDir:join(root,'data'), pluginsDir:plugins})
  try {
    const stage = await app.manager.toggle('engine-b', true)
    assert.equal(stage.pendingSwitch.group, 'engine')
    assert.equal(app.manager.records.get('engine-a').enabled, false)
    await app.manager.finishExclusive(stage.pendingSwitch.token, false, '取消验证')
    assert.equal(app.manager.records.get('engine-a').state, 'enabled')
    const retry = await app.manager.toggle('engine-b', true)
    await app.manager.finishExclusive(retry.pendingSwitch.token, true)
    await app.close()
    app = await createApp({port:0, dataDir:join(root,'data'), pluginsDir:plugins})
    assert.equal(app.manager.records.get('engine-b').state, 'enabled')
    assert.equal(app.manager.records.get('engine-a').enabled, false)
  } finally { await app.close() }
})

test('构建拒绝跨目录实现导入、未声明依赖和重复打包共享 React',async t=>{
  const {root,plugins}=await fixture(t), item=await plugin(plugins,'borrower')
  await writeFile(join(root,'outside.js'),'export const value=1')
  await writeFile(join(item.folder,'client.js'),"import {value} from '../../outside.js'; export default ()=>value")
  await assert.rejects(buildPlugins(plugins),/跨插件|跨目录/)
  await writeFile(join(item.folder,'client.js'),"import missing from 'undeclared-package'; export default ()=>missing")
  await assert.rejects(buildPlugins(plugins),/依赖未声明/)
  const owner=await plugin(plugins,'renderer',{runtimePackages:['react']})
  owner.pkg.dependencies.react='^19.3.0'; await owner.save()
  await writeFile(join(item.folder,'client.js'),"import React from 'react'; export default ()=>React")
  await assert.rejects(buildPlugins(plugins),/运行时由 renderer 提供/)
})
