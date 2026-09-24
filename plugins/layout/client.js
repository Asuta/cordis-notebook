import { provideMounts } from './mounts.js'
export default function (ctx, sdk) {
  const style = sdk.el('link', { rel: 'stylesheet', href: '/builtin/layout/style.css' }); document.head.append(style); sdk.effect(() => () => style.remove())
  const main = sdk.el('main', { class: 'notebook-shell' }), header = sdk.el('header'), heading = sdk.el('div')
  heading.append(sdk.el('div', { class: 'eyebrow' }, 'A LITTLE SPACE FOR YOUR MIND'), sdk.el('h1', {}, '留白，让想法发生。'))
  header.append(heading, sdk.el('span', { class: 'local' }, '由插件组成 · 为想法留白'))
  const workspace = sdk.el('section', { class: 'workspace' }), sidebar = sdk.el('aside', { class: 'sidebar' }), editor = sdk.el('section', { class: 'editor' }), toolbar = sdk.el('div', { class: 'editor-toolbar' }), status = sdk.el('span'), actions = sdk.el('div')
  toolbar.append(status, actions)
  const writing = sdk.el('div', { class: 'editor-slot' }), footer = sdk.el('footer', { class: 'editor-footer' }), panel = sdk.el('section', { class: 'extensions' })
  editor.append(toolbar, writing, footer); workspace.append(sidebar, editor); main.append(header, workspace, panel, sdk.el('footer', { class: 'page-footer' }, '留白 NOTEBOOK · POWERED BY CORDIS'))
  sdk.mount('app', main)
  const shell = provideMounts(sdk, 'shell', { sidebar, toolbar: actions, status, editor: writing, footer, panels: panel })
  shell.main = main
}
