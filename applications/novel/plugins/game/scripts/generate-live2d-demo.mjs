import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { imageProviderConfig } from '../live2d/image-provider.js'
import { generateModel, transparentSource } from '../live2d/generation.js'

const directory=fileURLToPath(new URL('../assets/avatar/',import.meta.url));await mkdir(directory,{recursive:true})
const reuse=process.argv.includes('--reuse'), previous=reuse?JSON.parse(await readFile(join(directory,'manifest.json'),'utf8')):[]
const load=async name=>{const asset=previous.find(a=>a.name===name);return asset?readFile(join(directory,asset.id+'.png')):undefined}
const source=await transparentSource(reuse?await load('银蓝 · 原始立绘.png'):await readFile(process.argv[2])), assets=[]
async function addAsset(name,bytes){const asset={id:previous.find(a=>a.name===name)?.id||crypto.randomUUID(),name,kind:'image',mime:'image/png',size:bytes.length};await writeFile(join(directory,asset.id+'.png'),bytes);assets.push(asset);return asset}
const original=await addAsset('银蓝 · 原始立绘.png',source.bytes)
const model=await generateModel({source:source.bytes,mime:'image/png',config:await imageProviderConfig(),signal:new AbortController().signal,progress:async(stage,message,percent)=>console.log(JSON.stringify({stage,message,percent})),addAsset,modelId:'silver-letter-avatar',sourceAssetId:original.id,name:'银蓝 · 动态角色',segmentationAsset:reuse?await load('AI 部件分区图.png'):undefined,repairAsset:reuse?await load('AI 脸部补画.png'):undefined,featureAsset:process.env.AVATAR_FEATURE_IMAGE?await readFile(process.env.AVATAR_FEATURE_IMAGE):reuse?await load('AI 眼嘴补画.png'):undefined})
model.revision=1
await writeFile(join(directory,'model.json'),JSON.stringify(model))
await writeFile(join(directory,'manifest.json'),JSON.stringify(assets,null,2))
console.log(JSON.stringify({modelId:model.id,parts:model.rig.parts.length,assets:assets.length,directory}))
