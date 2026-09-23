export default function(ctx, sdk) {
  const panel = sdk.el('section', { class: 'extension-panel', id: 'local-lab-panel' })
  const button = sdk.el('button', {}, '运行本机能力验证'), result = sdk.el('pre', {}, '尚未运行。测试仅写入本插件的数据目录。')
  panel.append(sdk.el('h3', {}, '本机能力实验室'), sdk.el('p', {}, '这是安装包带来的前端面板，后端在独立进程中运行。'), button, result)
  sdk.mount('panels', panel)
  sdk.listen(button, 'click', async () => {
    button.disabled = true; result.textContent = '正在调用独立后端…'
    try { const data = await sdk.rpc('inspect'); result.textContent = `文件：${data.file}\n读回：${data.text}\n命令结果：${data.command}\n笔记数量：${data.noteCount}\n独立进程 PID：${data.pid}` }
    catch (error) { result.textContent = error.message } finally { button.disabled = false }
  })
}
