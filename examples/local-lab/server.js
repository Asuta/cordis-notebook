import { writeFile, readFile } from 'node:fs/promises'
import { join } from 'node:path'

export default function(ctx, api) {
  api.handle('inspect', async () => {
    const file = join(api.dataDir, 'hello.txt')
    await writeFile(file, '你好，Cordis！这是第三方插件写入的文件。', 'utf8')
    const text = await readFile(file, 'utf8')
    const command = await api.exec(process.execPath, ['--version'])
    const notes = await api.host('notes.list')
    return { file, text, command: command.stdout.trim(), noteCount: notes.length, pid: process.pid }
  })
  console.log('本机能力实验室后端已启动')
  ctx.effect(() => () => console.log('本机能力实验室后端已清理'))
}
