import { Type } from '@sinclair/typebox'

const wait = Type.Optional(Type.Integer({ minimum: 0, maximum: 30000, description: '本次最多等待的毫秒数，默认 1000；到期仅返回，不终止命令。' }))
const id = Type.String({ description: 'exec_command 或 workspace_build 返回的 session_id。' })
export const commandTools = [
  ['exec_command', '在指定目录执行命令。Windows 使用 PowerShell，其他平台使用 Bash。内容搜索优先 rg，路径搜索优先 rg --files。短暂等待后返回输出及 session_id；status=running 时用 write_stdin 继续，禁止因此重复启动同一命令。', Type.Object({
    command: Type.String(), workdir: Type.Optional(Type.String({ description: '工作目录，默认项目根目录。每个命令单独指定，不继承上次 cd。' })), yield_time_ms: wait,
    background: Type.Optional(Type.Boolean({ description: '仅长期服务明确设为 true；聊天停止会保留它。搜索、测试、构建不得以此逃避停止。默认 false。' })),
    tty: Type.Optional(Type.Boolean({ description: '需要真实终端交互时设为 true，普通命令使用默认管道。' })),
  })],
  ['write_stdin', '获取命令尚未读取的输出，或向运行中的命令输入文本。输入接受后排队写入，不因等待返回而重复发送；stdin_pending_bytes 是管道待写入字节数，stdin_error 表示写入失败。等待窗口结束不杀进程。has_more=true 时继续读取；status=exited 后根据 exit_code 判断结果。', Type.Object({
    session_id: id, chars: Type.Optional(Type.String({ description: '输入文本；确认输入时通常追加换行。省略时只读取输出。' })),
    close_stdin: Type.Optional(Type.Boolean({ description: '关闭管道标准输入以发送 EOF；不适用于 PTY。' })), yield_time_ms: wait,
  })],
  ['terminate_command', '终止当前聊天指定命令及其子进程，包括明确启动的后台服务。不会回滚已完成的修改。', Type.Object({ session_id: id })],
  ['list_commands', '列出当前聊天保留的命令会话及状态。恢复对话后先查询，不猜测 session_id。', Type.Object({})],
]

export const commandGuidance = [
  '搜索文本优先 rg，查找文件优先 rg --files。rg 已加入命令环境 PATH。先限定相关应用、插件或目录，再扩大范围；默认尊重 .gitignore，检查被忽略的依赖或产物时指定目录后再使用 --no-ignore。',
  '示例：rg -n "createAgentSession" workbench -g "*.js"；rg --files applications/notebook -g "*.jsx"。先决定需要匹配行、文件名（-l）还是存在性（-q）。rg 退出码 1 表示没有匹配，不是工具损坏。',
  '避免 Get-ChildItem -Recurse 遍历全仓库后再过滤依赖目录。Windows 使用 PowerShell 语法；读取文件优先 read，修改文件优先 edit/write。',
  'exec_command/workspace_build 返回 running 仅表示仍在运行，不表示成功。用 write_stdin 持续读取，不重复启动；只能并行进行不依赖命令结果的工作，构建测试必须获取退出码后再报告结论。等待无新增输出时延长轮询窗口，不密集空轮询。',
  '普通命令默认 background=false。只有明确长期运行的服务才设为 true，回复时报告仍在运行的服务。停止不再需要的命令用 terminate_command。工作台重启后先 list_commands；旧 session_id 不能恢复。',
  '长期服务直接作为 exec_command 的命令启动并设 background=true；不要通过 Start-Process、nohup 或自行脱离进程管理的方式隐藏服务。',
]
