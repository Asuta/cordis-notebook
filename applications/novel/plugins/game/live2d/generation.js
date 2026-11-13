import sharp from 'sharp'
import { blankModel, addImagePart, autoRig } from './document.js'
import { editImage } from './image-provider.js'

export const palette = [
  {role:'hair-back',name:'后发',rgb:[255,255,0]}, {role:'torso',name:'身体与服装',rgb:[255,0,255]},
  {role:'face',name:'脸与脖颈',rgb:[255,0,0]}, {role:'hair-front',name:'前发',rgb:[0,0,255]},
  {role:'eye-left',name:'左眼（画面左）',rgb:[0,255,255]}, {role:'eye-right',name:'右眼（画面右）',rgb:[255,128,0]},
  {role:'brow-left',name:'左眉',rgb:[128,0,255]}, {role:'brow-right',name:'右眉',rgb:[0,128,255]},
  {role:'mouth',name:'嘴巴',rgb:[128,64,0]}, {role:'accessory',name:'独立饰品',rgb:[255,128,128]},
]
export async function transparentSource(bytes) {
  const {data,info}=await sharp(bytes,{limitInputPixels:40e6}).rotate().resize({width:1024,height:1536,fit:'inside',withoutEnlargement:true}).ensureAlpha().raw().toBuffer({resolveWithObject:true})
  // Chroma key only when that color is actually the dominant border background.
  let green=0,border=0;for(let y=0;y<info.height;y+=Math.max(1,Math.floor(info.height/100)))for(const x of [0,info.width-1]){const i=(y*info.width+x)*4;border++;if(data[i+1]>180&&data[i+1]>data[i]*1.5&&data[i+1]>data[i+2]*1.5)green++}
  if(green>border*.6)for(let i=0;i<data.length;i+=4){const neutral=Math.max(data[i],data[i+2]),excess=data[i+1]-neutral;if(excess>60&&data[i+1]>150)data[i+3]=Math.min(data[i+3],Math.max(0,255-(excess-60)*3));if(excess>25)data[i+1]=Math.min(data[i+1],neutral+20)}
  return {data,info,bytes:await sharp(data,{raw:info}).png().toBuffer()}
}
export async function splitFromMap(sourceBytes,mapBytes,repairBytes,{addAsset,name='AI 角色',modelId,sourceAssetId,progress=async()=>{},signal}={}) {
  const {data:original,info}=await transparentSource(sourceBytes), w=info.width,h=info.height
  const mask=await sharp(mapBytes,{limitInputPixels:40e6}).resize(w,h,{fit:'fill'}).removeAlpha().raw().toBuffer(), repaired=repairBytes?await sharp(repairBytes,{limitInputPixels:40e6}).resize(w,h,{fit:'fill'}).ensureAlpha().raw().toBuffer():original
  const labels=new Int16Array(w*h).fill(-1), counts=palette.map(()=>0), bounds=palette.map(()=>({left:w,top:h,right:0,bottom:0}))
  for(let p=0;p<w*h;p++){if(original[p*4+3]<12)continue;let best=-1,dist=Infinity;for(let j=0;j<palette.length;j++){const rgb=palette[j].rgb,d=(mask[p*3]-rgb[0])**2+(mask[p*3+1]-rgb[1])**2+(mask[p*3+2]-rgb[2])**2;if(d<dist){dist=d;best=j}}if(dist>3600)continue;labels[p]=best;counts[best]++}
  // Small antialiased fragments can be nearer another label color. Keep the
  // principal connected feature instead of stretching its mesh across the body.
  for (const j of [4,5,6,7,8]) {
    const seen = new Uint8Array(w*h), queue = new Int32Array(w*h); let largest = []
    for (let start=0;start<labels.length;start++) if(labels[start]===j&&!seen[start]) {
      let head=0,tail=1;queue[0]=start;seen[start]=1
      while(head<tail){const at=queue[head++],x=at%w;for(const next of [x?at-1:-1,x<w-1?at+1:-1,at-w,at+w])if(next>=0&&next<labels.length&&!seen[next]&&labels[next]===j){seen[next]=1;queue[tail++]=next}}
      if(tail>largest.length)largest=Array.from(queue.subarray(0,tail))
    }
    const keep=new Set(largest);for(let p=0;p<labels.length;p++)if(labels[p]===j&&!keep.has(p)){labels[p]=-1;counts[j]--}
  }
  for(let p=0;p<labels.length;p++)if(labels[p]>=0){const b=bounds[labels[p]],x=p%w,y=Math.floor(p/w);b.left=Math.min(b.left,x);b.right=Math.max(b.right,x);b.top=Math.min(b.top,y);b.bottom=Math.max(b.bottom,y)}
  const significant=counts.filter(n=>n>w*h*.0003).length
  if(significant<4||counts[2]<w*h*.005)throw Error('AI 分区图未能识别足够的部件，请调整原图或在分区画布中修正后重新绑定')
  const model=blankModel(name,modelId,w,h);model.sourceAssetId=sourceAssetId
  for(let j=0;j<palette.length;j++){
    signal?.throwIfAborted();if(counts[j]<Math.max(15,w*h*.00005))continue
    const buf=Buffer.alloc(w*h*4),role=palette[j].role
    for(let p=0;p<w*h;p++){let use=labels[p]===j;const hiddenFace=j===2&&labels[p]>=4&&labels[p]<=8;
      if(use||hiddenFace){const offset=p*4,texture=j===2&&repairBytes?repaired:original;buf[offset]=texture[offset];buf[offset+1]=texture[offset+1];buf[offset+2]=texture[offset+2];buf[offset+3]=use?original[offset+3]:255;}
    }
    const image=sharp(buf,{raw:{width:w,height:h,channels:4}}).trim({background:'#00000000',threshold:1}), output=await image.png().toBuffer({resolveWithObject:true}), meta=output.info
    // trimOffset is negative when pixels are removed from the top/left.
    const left=-(meta.trimOffsetLeft||0),top=-(meta.trimOffsetTop||0)
    const asset=await addAsset(palette[j].name+'.png',output.data);asset.width=meta.width;asset.height=meta.height
    addImagePart(model,asset,role,left+meta.width/2,top+meta.height/2);await progress('extract','已提取'+palette[j].name,55+(j+1)*3)
  }
  model.generation={sourceAssetId,palette:palette.map(p=>({role:p.role,color:p.rgb})),method:'semantic-map-and-local-repair',needsReview:true}
  return model
}
export async function addFaceVariants(model, featureBytes, addAsset) {
  const w=model.rig.stage.width,h=model.rig.stage.height
  const image=await sharp(featureBytes,{limitInputPixels:40e6}).resize(w,h,{fit:'fill'}).ensureAlpha().raw().toBuffer()
  for (const [role,variant,label] of [['eye-left','eye-left-closed','左眼闭眼'],['eye-right','eye-right-closed','右眼闭眼'],['mouth','mouth-open','自然张嘴']]) {
    const base=model.rig.parts.find(p=>p.role===role),texture=model.rig.assets.find(a=>a.id===base?.assetId);if(!base||!texture)continue
    const width=Math.min(w,Math.ceil(texture.width*1.45)),height=Math.min(h,Math.ceil(Math.max(texture.height*1.7,texture.width*(role==='mouth'?.85:.65))))
    const left=Math.max(0,Math.min(w-width,Math.round(base.transform.x-width/2))),top=Math.max(0,Math.min(h-height,Math.round(base.transform.y-height/2)))
    const pixels=await sharp(image,{raw:{width:w,height:h,channels:4}}).extract({left,top,width,height}).raw().toBuffer()
    // A narrow feather hides the repaired skin seam without cutting eyelashes.
    const edge=Math.max(2,Math.min(width,height)*.12)
    for(let y=0;y<height;y++)for(let x=0;x<width;x++)pixels[(y*width+x)*4+3]*=Math.min(1,Math.min(x,y,width-1-x,height-1-y)/edge)
    const bytes=await sharp(pixels,{raw:{width,height,channels:4}}).png().toBuffer(),asset=await addAsset(label+'.png',bytes)
    asset.width=width;asset.height=height
    const id=addImagePart(model,asset,variant,left+width/2,top+height/2),part=model.rig.parts.find(p=>p.id===id)
    part.drawOrder=base.drawOrder+1
  }
  return model
}
export async function generateModel({source,mime,config,signal,progress,addAsset,modelId,sourceAssetId,name,segmentationAsset,repairAsset,featureAsset}) {
  const cleaned=await transparentSource(source)
  await progress('segment','AI 正在识别头发、五官与身体分区',10)
  const legend=palette.map(p=>p.name+'=RGB('+p.rgb.join(',')+')').join('; ')
  const mapBytes=segmentationAsset||await editImage(config,source,mime,'Create an EXACT pixel-aligned semantic segmentation label map of the reference illustration. Keep the original canvas, pose, silhouette and feature positions absolutely unchanged. Output FLAT SOLID label colors ONLY, no outlines, shading, texture, text, legend or antialiasing. Background pure black RGB(0,0,0). Label every visible pixel of the character using these colors: '+legend+'. Both eyes include iris, sclera and eyelash, but eyebrows must be separate. Mouth includes lips and interior. Do not merge eyes into face. Preserve the exact location of every feature. This is a segmentation mask, not an illustration.',signal)
  signal.throwIfAborted();const maskAsset=await addAsset('AI 部件分区图.png',await sharp(mapBytes).png().toBuffer())
  await progress('repair','AI 正在补齐五官和头发下面的脸部纹理',35,{segmentationAssetId:maskAsset.id})
  const repairBytes=repairAsset||await editImage(config,source,mime,'Edit the reference illustration as a Live2D base FACE texture. Keep exact original canvas size, head position, skin tone, lighting and drawing style. Remove eyes, eyelashes, eyebrows and mouth completely, fill those regions with matching clean skin. Remove front bangs that cover the forehead and restore the forehead skin underneath. Keep the nose, face outline, ears and neck aligned exactly. Other regions should remain unchanged. No text, no grids.',signal)
  signal.throwIfAborted();const repair=await addAsset('AI 脸部补画.png',await sharp(repairBytes).png().toBuffer())
  await progress('features','AI 正在绘制自然闭眼与张嘴素材',48,{repairAssetId:repair.id})
  const featureBytes=featureAsset||await editImage(config,source,mime,'Create a pixel-aligned facial variant of this exact illustration. Change ONLY both eyes into naturally closed eyelids with curved eyelashes, and the mouth into a small open speaking smile with a dark warm interior and subtle upper teeth. Keep the eye corners and mouth center exactly in place. Keep original canvas, head position, proportions, skin tone, pose, hair and all other pixels unchanged. No text or grids.',signal)
  signal.throwIfAborted();const feature=await addAsset('AI 眼嘴补画.png',await sharp(featureBytes).png().toBuffer())
  await progress('extract','按分区提取原图像素，合成遮挡区域',55,{repairAssetId:repair.id,featureAssetId:feature.id})
  const model=await splitFromMap(cleaned.bytes,mapBytes,repairBytes,{addAsset,modelId,sourceAssetId,name,progress,signal})
  signal.throwIfAborted();await addFaceVariants(model,featureBytes,addAsset)
  model.generation.segmentationAssetId=maskAsset.id;model.generation.repairAssetId=repair.id;model.generation.featureAssetId=feature.id
  await progress('rig','生成参数关键形、头部层级与头发物理',92)
  return autoRig(model)
}
