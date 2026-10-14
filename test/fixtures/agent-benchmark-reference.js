import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

// Independent known-good implementations test the judge, never copied into Agent projects.
export async function referencePlugin(project, task, broken = false) {
  const files = {}, m = { schemaVersion: 1, id: task.pluginId, name: task.name, defaultEnabled: false,
    requires: { client: [], server: [] }, provides: { client: [], server: [] }, public: [], styles: [], build: [] }
  if (task.id === 'backend') {
    m.requires.server = ['http', 'notes']
    files['server.js'] = `export default function(ctx) { ctx.http.route(ctx,'GET',/^\\/api\\/plugins\\/note-summary\\/summary$/,()=>{
      const notes=ctx.notes.list(), byType={}; for(const n of notes)byType[n.type]=(byType[n.type]||0)+1;
      return {total:${broken ? '999' : 'notes.length'},pinned:notes.filter(n=>n.pinned).length,byType};
    }) }`
  } else if (task.id === 'content') {
    m.requires.client = ['notebook', 'shell']
    files['client.js'] = `export default function(ctx,sdk){const node=sdk.el('span',{'data-testid':'paragraph-count'});sdk.mount('footer',node);ctx.notebook.observe(ctx,()=>{
      const n=ctx.notebook.current();if(!n){node.textContent='未选择笔记';return}
      const raw=n.type==='markdown'?n.markdown:n.content;node.textContent=(String(raw||'').trim()?String(raw).trim().split(/\\n[ \\t]*\\n/).filter(x=>x.trim()).length:0)+' 段';
    })}`
  } else if (task.id === 'action') {
    m.requires.client = ['notebook', 'shell']
    files['client.js'] = `export default function(ctx,sdk){const button=sdk.button('toolbar','复制标题',async()=>{await navigator.clipboard.writeText(ctx.notebook.current().title);sdk.toast('标题已复制')});button.setAttribute('aria-label','复制标题');ctx.notebook.observe(ctx,()=>button.disabled=!ctx.notebook.current())}`
  } else if (task.id === 'date-action') {
    m.requires.client = ['notebook', 'shell']
    files['client.js'] = `export default function(ctx,sdk){const model=ctx.notebook, field=n=>n?.type==='plain'?'content':n?.type==='markdown'?'markdown':null;
      const button=sdk.button('toolbar','插入当前日期',async()=>{const note=model.current(),key=field(note);if(!key||model.busy||!model.editable)return;
        const now=new Date(),date=${broken ? "'1999-01-01'" : "[now.getFullYear(),String(now.getMonth()+1).padStart(2,'0'),String(now.getDate()).padStart(2,'0')].join('-')"};
        model.edit({[key]:note[key]+(note[key]?'\\n':'')+date});await model.flush()});button.setAttribute('aria-label','插入当前日期');
      model.observe(ctx,()=>button.disabled=!field(model.current())||model.busy||!model.editable)}`
  } else if (task.id === 'editor') {
    m.requires.client = ['notebook', 'noteFormats', 'editorHost']; m.requires.server = ['noteFormats']
    files['format.js'] = `export const format={type:'simple-page',label:'便签页面',icon:'FileText',editor:'simple-page',fields:['body'],defaults:()=>({body:''}),normalize(data){if(typeof data.body!=='string')throw Error('body 必须为文本');return {body:data.body}},toText:data=>data.body}`
    files['server.js'] = `import {format} from './format.js';export default function(ctx){ctx.noteFormats.register(ctx,format)}`
    files['client.js'] = `import {format} from './format.js';export default function(ctx,sdk){ctx.noteFormats.register(ctx,format);const node=sdk.el('textarea',{'aria-label':'便签正文'});ctx.editorHost.register(ctx,'simple-page',node);sdk.listen(node,'input',()=>ctx.notebook.edit({body:node.value}));ctx.notebook.observe(ctx,()=>{const n=ctx.notebook.current();node.disabled=ctx.notebook.busy||!ctx.notebook.editable;if(n?.type==='simple-page'&&node.value!==n.body)node.value=n.body})}`
  } else if (task.id === 'canvas') {
    m.requires.client = ['canvasUI']
    files['client.js'] = `export default function(ctx){ctx.canvasUI.menu(ctx,{id:'quick-card',label:'创建便签',run:()=>ctx.canvasUI.add('text',{title:'快速便签',text:'从插件创建'})})}`
  }
  for (const side of ['client', 'server']) if (files[side + '.js']) {
    m[side] = side === 'client' ? 'client.js' : { entry: 'server.js', export: 'default' }
    if (side === 'client') m.public.push('client.js')
    m.build.push({ type: 'bundle', input: side + '.js', output: side + '.js', platform: side === 'client' ? 'browser' : 'node' })
  }
  const root = join(project, 'applications', task.appId, 'plugins', task.pluginId)
  await mkdir(root, { recursive: true })
  for (const [name, content] of Object.entries(files)) await writeFile(join(root, name), content)
  await writeFile(join(root, 'package.json'), JSON.stringify({ name: '@benchmark/' + task.pluginId, version: '1.0.0', private: true, type: 'module', cordis: m }))
}
