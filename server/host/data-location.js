import { cp, open, readFile, readdir, realpath, rename, rm, stat } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { randomUUID } from 'node:crypto'
import { spawn } from 'node:child_process'
import sharp from 'sharp'
import { writeSnapshot } from '../../shared/persistence.js'

const applicationLocationsName = '.cordis-application-data.json'
const applicationIdentityName = '.cordis-application.json'

export function defaultDataDirectory(root) {
  return resolve(root, 'data')
}

export function applicationDataLocationFile(root) {
  return join(resolve(root), applicationLocationsName)
}

export async function readApplicationDataDirectories(root) {
  try {
    const value = JSON.parse((await readFile(applicationDataLocationFile(root), 'utf8')).replace(/^\uFEFF/, ''))
    if (value?.version !== 1 || !value.paths || typeof value.paths !== 'object' || Array.isArray(value.paths)) throw Error('应用数据目录设置格式无效')
    return Object.fromEntries(Object.entries(value.paths).filter(([id, path]) => /^[a-z][a-z0-9-]{1,49}$/.test(id) && isAbsolute(path)).map(([id, path]) => [id, resolve(path)]))
  } catch (error) {
    if (error.code === 'ENOENT') return {}
    throw Object.assign(Error('读取应用数据目录设置失败：' + error.message), { status: 500 })
  }
}

export async function readApplicationDataDirectory(root, appId) {
  return (await readApplicationDataDirectories(root))[appId] || null
}

export async function writeApplicationDataDirectory(root, appId, directory) {
  const paths = await readApplicationDataDirectories(root)
  paths[appId] = resolve(directory)
  await writeSnapshot(applicationDataLocationFile(root), JSON.stringify({ version: 1, paths }, null, 2))
  return paths[appId]
}

export async function removeApplicationDataDirectory(root, appId) {
  const paths = await readApplicationDataDirectories(root)
  if (!Object.hasOwn(paths, appId)) return false
  delete paths[appId]
  await writeSnapshot(applicationDataLocationFile(root), JSON.stringify({ version: 1, paths }, null, 2))
  return true
}

export async function inspectDataDirectory(directory) {
  if (!isAbsolute(directory)) throw Object.assign(Error('请提供数据文件夹的绝对路径'), { status: 400 })
  const path = await realpath(directory).catch(error => {
    if (error.code === 'ENOENT') return null
    throw error
  })
  if (!path) throw Object.assign(Error('目标文件夹不存在'), { status: 400 })
  const info = await stat(path)
  if (!info.isDirectory()) throw Object.assign(Error('目标不是文件夹'), { status: 400 })
  return path
}

export async function ensureApplicationDataIdentity(directory, appId) {
  if (typeof appId !== 'string' || !appId) throw Object.assign(Error('应用 ID 无效'), { status: 400 })
  const marker = join(directory, applicationIdentityName)
  let identity
  try {
    identity = JSON.parse((await readFile(marker, 'utf8')).replace(/^\uFEFF/, ''))
  } catch (error) {
    if (error.code !== 'ENOENT') throw Object.assign(Error('数据目录的应用标识无效'), { status: 400 })
  }
  if (identity) {
    if (identity.version !== 1 || identity.id !== appId) throw Object.assign(Error('所选文件夹属于其他应用'), { status: 400 })
    return
  }
  await writeSnapshot(marker, JSON.stringify({ version: 1, id: appId }, null, 2))
}

export async function validateDataDirectory(directory) {
  let files = 0
  async function walk(current) {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const path = join(current, entry.name)
      if (entry.isDirectory()) { await walk(path); continue }
      if (entry.isSymbolicLink()) throw Object.assign(Error(`数据目录不能包含符号链接：${relative(directory, path)}`), { status: 400 })
      if (!entry.isFile()) continue
      files++
      if (entry.name.endsWith('.json')) {
        try { JSON.parse((await readFile(path, 'utf8')).replace(/^\uFEFF/, '')) }
        catch { throw Object.assign(Error(`数据文件无法解析：${relative(directory, path)}`), { status: 400 }) }
      } else if (/\.(png|jpe?g|webp)$/i.test(entry.name)) {
        const info = await sharp(path).metadata().catch(() => null), format = info?.format
        if (!['png', 'jpeg', 'webp'].includes(format)) throw Object.assign(Error(`图片文件无效：${relative(directory, path)}`), { status: 400 })
      } else if (/\.(mp4|webm)$/i.test(entry.name)) {
        const handle = await open(path, 'r'), header = Buffer.alloc(16)
        let bytesRead = 0
        try { bytesRead = (await handle.read(header, 0, header.length, 0)).bytesRead }
        finally { await handle.close() }
        const valid = /\.mp4$/i.test(entry.name)
          ? bytesRead >= 12 && header.toString('ascii', 4, 8) === 'ftyp'
          : bytesRead >= 4 && header.readUInt32BE(0) === 0x1a45dfa3
        if (!valid) throw Object.assign(Error(`视频文件无效：${relative(directory, path)}`), { status: 400 })
      }
    }
  }
  await walk(directory)
  return { files }
}

function nested(left, right) {
  const rel = relative(left, right)
  return rel === '' || rel !== '..' && !rel.startsWith('..' + sep) && !isAbsolute(rel)
}

function separate(left, right) {
  if (nested(left, right) || nested(right, left)) throw Object.assign(Error('目标文件夹不能与当前数据目录互相包含'), { status: 400 })
}

async function inventoryDataDirectory(directory) {
  const files = new Map()
  async function walk(current) {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const path = join(current, entry.name)
      if (entry.isSymbolicLink()) throw Object.assign(Error(`数据目录不能包含符号链接：${relative(directory, path)}`), { status: 400 })
      if (entry.isDirectory()) { await walk(path); continue }
      if (entry.isFile()) files.set(relative(directory, path).split(sep).join('/'), (await stat(path)).size)
    }
  }
  await walk(directory)
  return files
}

function assertSameInventory(source, target) {
  const sourceBytes = [...source.values()].reduce((sum, size) => sum + size, 0)
  const targetBytes = [...target.values()].reduce((sum, size) => sum + size, 0)
  const missing = [...source.keys()].filter(path => target.get(path) !== source.get(path))
  if (missing.length || source.size !== target.size) {
    throw Object.assign(Error(`数据复制不完整：源目录 ${source.size} 个文件/${sourceBytes} 字节，目标目录 ${target.size} 个文件/${targetBytes} 字节${missing.length ? `，缺失 ${missing.length} 个文件` : ''}`), { status: 500 })
  }
}

function releaseSharpFileHandles() {
  const previous = sharp.cache()
  sharp.cache(false)
  return () => sharp.cache({ memory: previous.memory.max, files: previous.files.max, items: previous.items.max })
}

async function renameWithRetry(source, target) {
  for (let attempt = 0; ; attempt++) {
    try { return await rename(source, target) }
    catch (error) {
      if (!['EACCES', 'EBUSY', 'EPERM'].includes(error.code) || attempt >= 5) throw error
      await new Promise(resolve => setTimeout(resolve, 100 * (attempt + 1)))
    }
  }
}

export async function migrateDataDirectory(source, target) {
  source = await realpath(source)
  target = await inspectDataDirectory(target)
  separate(source, target)
  const existing = await readdir(target)
  if (existing.length) throw Object.assign(Error('迁移目标必须是空文件夹，请选择新的位置'), { status: 400 })
  const staging = join(dirname(target), '.' + basename(target) + '-cordis-' + randomUUID())
  let restoreSharpCache
  try {
    const sourceFiles = await inventoryDataDirectory(source)
    await cp(source, staging, { recursive: true, force: false, errorOnExist: true })
    assertSameInventory(sourceFiles, await inventoryDataDirectory(staging))
    const checked = await validateDataDirectory(staging)
    // libvips keeps recently read image files open on Windows. Release those
    // handles before replacing the selected directory or the rename can fail
    // with EPERM even though the copy and validation both completed.
    restoreSharpCache = releaseSharpFileHandles()
    await rm(target, { recursive: true, force: false, maxRetries: 5, retryDelay: 100 })
    await renameWithRetry(staging, target)
    return { path: target, ...checked }
  } finally {
    restoreSharpCache?.()
    await rm(staging, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }).catch(() => {})
  }
}

export async function validateAttachedApplicationDataDirectory(directory, source, appId) {
  const path = await inspectDataDirectory(directory)
  if (source) separate(await realpath(source), path)
  const checked = await validateDataDirectory(path)
  const entries = await readdir(path)
  if (entries.length) {
    let identity
    try { identity = JSON.parse((await readFile(join(path, applicationIdentityName), 'utf8')).replace(/^\uFEFF/, '')) }
    catch (error) {
      if (error.code !== 'ENOENT') throw Object.assign(Error('数据目录的应用标识无效'), { status: 400 })
    }
    if (!identity || identity.version !== 1 || identity.id !== appId) throw Object.assign(Error('所选文件夹不是当前应用的数据目录'), { status: 400 })
  }
  return { path, ...checked }
}

export async function chooseDataDirectory() {
  if (process.platform !== 'win32') throw Object.assign(Error('当前系统请直接输入文件夹路径'), { status: 400 })
  const script = [
    'Add-Type -AssemblyName System.Windows.Forms',
    '$dialog = New-Object System.Windows.Forms.FolderBrowserDialog',
    "$dialog.Description = '选择当前应用的数据文件夹'",
    '$dialog.ShowNewFolderButton = $true',
    "if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8; Write-Output $dialog.SelectedPath }",
  ].join('; ')
  return await new Promise((resolvePromise, reject) => {
    const child = spawn('powershell.exe', ['-NoProfile', '-STA', '-Command', script], { windowsHide: false, stdio: ['ignore', 'pipe', 'pipe'] })
    let output = '', error = ''
    child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8')
    child.stdout.on('data', chunk => output += chunk); child.stderr.on('data', chunk => error += chunk)
    child.on('error', reject)
    child.on('exit', code => {
      if (code !== 0) return reject(Object.assign(Error(error.trim() || '无法打开文件夹选择器'), { status: 500 }))
      const path = output.trim()
      if (!path) return resolvePromise(null)
      resolvePromise(path)
    })
  })
}
