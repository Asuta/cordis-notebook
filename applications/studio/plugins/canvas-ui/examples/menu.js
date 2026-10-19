// 最小只读菜单。修改画板请使用 studio-action 模板的版本及异步保护。
export default function (ctx, sdk) {
  ctx.canvasUI.menu(ctx, { id: 'example-menu', label: '查看画布', order: 30,
    run: () => sdk.toast('当前画板：' + ctx.canvasUI.board().title),
  })
}
