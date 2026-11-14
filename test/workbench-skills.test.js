import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { Window } from 'happy-dom'
import { validateSettings } from '../workbench/config.js'
import { validateSkills, skillsForApp } from '../workbench/skills-config.js'
import { scanSkills, skillCatalog, skillPrompt } from '../workbench/skills.js'
import { createWorkbench } from '../workbench/server.js'
import { createSkillsSettings } from '../workbench/public/skills-settings.js'

const lines = values => values.join(String.fromCharCode(10))
async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'cordis-skills-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const directory = join(root, '指定技能目录')
  async function skill(path, name, extra = '', body = '技能正文 sentinel') {
    await mkdir(join(directory, path), { recursive: true })
    const file = join(directory, path, 'SKILL.md')
    await writeFile(file, lines(['---', 'name: ' + name, 'description: ' + name + ' 工作流', extra, '---', body]))
    return file
  }
  return { root, directory, skill }
}

test('指定目录递归加载、诊断、刷新和应用筛选均复用 Pi', async t => {
  const f = await fixture(t)
  const shared = await f.skill('shared', 'shared')
  const limited = await f.skill('nested/limited', 'limited')
  await f.skill('manual', 'manual', 'disable-model-invocation: true')
  await f.skill('z-duplicate', 'shared')
  await f.skill('broken', 'broken')
  await writeFile(join(f.directory, 'broken/SKILL.md'), '没有元数据')
  await mkdir(join(f.root, '.pi/skills/unwanted'), { recursive: true })
  await writeFile(join(f.root, '.pi/skills/unwanted/SKILL.md'), lines(['---', 'name: unwanted', 'description: 不应自动加载', '---', '正文']))
  const config = validateSkills({ directory: f.directory, rules: [{ path: limited, enabled: true, apps: ['notebook'] }, { path: shared, enabled: false, apps: null }] })
  const catalog = await scanSkills(f.root, config)
  assert.deepEqual(catalog.skills.map(s => s.name).sort(), ['limited', 'manual', 'shared'])
  assert.ok(catalog.diagnostics.some(d => d.type === 'collision'))
  assert.ok(catalog.diagnostics.some(d => d.path.endsWith(join('broken', 'SKILL.md'))))
  assert.deepEqual(skillsForApp(catalog, config, 'drawing').skills.map(s => s.name), ['manual'])
  assert.deepEqual(skillsForApp(catalog, config, 'notebook').skills.map(s => s.name).sort(), ['limited', 'manual'])
  const view = await skillCatalog(f.root, config)
  assert.equal(view.skills.find(s => s.name === 'manual').manualOnly, true)
  assert.equal(view.skills.find(s => s.name === 'shared').enabled, false)
  await f.skill('new', 'new')
  assert.ok((await scanSkills(f.root, config)).skills.some(s => s.name === 'new'))
  assert.match((await scanSkills(f.root, { directory: join(f.root, 'missing') })).diagnostics[0].message, /不存在/)
  assert.match((await scanSkills(f.root, { directory: shared })).diagnostics[0].message, /文件夹/)
  assert.deepEqual(await scanSkills(f.root, validateSkills()), { skills: [], diagnostics: [] })
  assert.equal(skillPrompt(lines(['/skill:manual', '执行任务']), catalog.skills), '/skill:manual 执行任务')
  assert.throws(() => skillPrompt('/skill:shared 执行', skillsForApp(catalog, config, 'drawing').skills), /没有可用的技能/)
})

test('HTTP 技能预览不保存，保存后重启保留范围且不返回密钥', async t => {
  const f = await fixture(t), file = await f.skill('workflow', 'workflow')
  const skills = { directory: f.directory, rules: [{ path: file, enabled: true, apps: ['notebook'] }] }
  const dataDir = join(f.root, 'settings')
  await mkdir(dataDir); await writeFile(join(dataDir, 'config.json'), JSON.stringify({ apiKey: 'fixture-skill-secret' }))
  let wb = await createWorkbench({ root: resolve('.'), port: 0, appPort: 0, dataDir, autoStart: false })
  t.after(() => wb.close())
  const request = async (path, data) => {
    const response = await fetch('http://127.0.0.1:' + wb.server.address().port + '/api/' + path, data === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) })
    return { status: response.status, body: await response.json() }
  }
  const preview = await request('skills/scan', skills)
  assert.equal(preview.status, 200); assert.equal(preview.body.skills[0].name, 'workflow')
  assert.deepEqual((await request('config')).body.skills, { directory: '', rules: [] })
  assert.equal((await request('config', { skills })).status, 200)
  const settings = (await request('config')).body
  assert.deepEqual(settings.skills, skills); assert.ok(!JSON.stringify(settings).includes('fixture-skill-secret'))
  assert.equal((await request('config', { skills: { directory: 'relative/path' } })).status, 400)
  assert.equal((await request('config', { skills: { ...skills, rules: [{ path: file, enabled: true, apps: [] }] } })).status, 400)
  assert.equal((await request('skills/scan', { directory: 42 })).status, 400)
  assert.equal((await fetch('http://127.0.0.1:' + wb.server.address().port + '/skills-settings.js')).status, 200)
  await wb.close()
  wb = await createWorkbench({ root: resolve('.'), port: 0, appPort: 0, dataDir, autoStart: false })
  assert.deepEqual((await request('config')).body.skills, skills)
  assert.deepEqual(validateSettings({ thinking: false }, settings).skills, skills)
  assert.throws(() => validateSkills({ ...skills, rules: [{ path: file, enabled: 'false', apps: null }] }), /布尔值/)
})

test('技能设置草稿、取消和过期扫描隔离', async t => {
  const window = new Window(), document = window.document
  t.after(() => window.happyDOM.close())
  document.write((await readFile('workbench/public/index.html', 'utf8')).split('<script')[0])
  let pending
  const catalog = { skills: [{ name: 'workflow', description: '<img src=x> 仅文字', path: '/skills/workflow/SKILL.md' }], diagnostics: [] }
  const ui = createSkillsSettings({ document, request: () => new Promise(resolve => { pending = resolve }) })
  const $ = id => document.getElementById(id)
  const opening = ui.open({ directory: '/skills', rules: [] }, [{ id: 'notebook', name: '笔记' }, { id: 'drawing', name: '画图' }])
  pending(catalog); await opening
  assert.equal($('skills-list').querySelector('img'), null)
  const scope = $('skills-list').querySelector('select'); scope.value = 'selected'; scope.onchange()
  assert.throws(() => ui.value(), /至少选择/)
  const app = document.querySelector('[aria-label="workflow：笔记"]'); app.checked = true; app.onchange()
  const enabled = document.querySelector('[aria-label="启用 workflow"]'); enabled.checked = false; enabled.onchange()
  const refreshing = $('skills-refresh').onclick(); pending(catalog); await refreshing
  assert.deepEqual(ui.value().rules, [{ path: '/skills/workflow/SKILL.md', enabled: false, apps: ['notebook'] }])
  ui.close()
  const reopen = ui.open({ directory: '/skills', rules: [] }); pending(catalog); await reopen
  assert.deepEqual(ui.value().rules, [])
  const old = $('skills-refresh').onclick()
  $('skills-directory').value = '/new-skills'; $('skills-directory').oninput()
  pending(catalog); await old
  assert.equal($('skills-list').children.length, 0)
  assert.match($('skills-status').textContent, /目录已修改/)
  assert.equal(ui.value().directory, '/new-skills')
})
