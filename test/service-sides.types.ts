import type { ClientContext, ServerContext } from '@cordis-notebook/host'
import type {} from '@cordis-notebook/rich-text/client'
import type {} from '@cordis-notebook/rich-text/server'
import type {} from '@cordis-notebook/note-assets/client'
import type {} from '@cordis-notebook/note-assets/server'
import type {} from '@cordis-notebook/theme-engine/client'
import type {} from '@cordis-notebook/theme-engine/server'
import type {} from '@cordis-notebook/notebook/client'
import type {} from '@cordis-notebook/notes/server'
import type {} from '@cordis-notebook/host/server'
import type { Context, Plugin } from 'cordis'
declare const client: ClientContext
declare const server: ServerContext
server.richText.normalize({ version: 1, elements: [] })
const path: string = server.noteAssets.directory
server.themeEngine.activate(server, 'sample')
client.noteAssets.upload(new File([], 'sample.png'))
// @ts-expect-error Backend document capability has no DOM editor.
server.richText.mount(server, document.body, {})
// @ts-expect-error Backend storage location does not expose browser upload.
server.noteAssets.upload(new File([], path))
// @ts-expect-error Browser theme styles do not expose backend activation.
client.themeEngine.activate(client, 'sample')
// @ts-expect-error Browser upload service does not expose local storage paths.
client.noteAssets.directory

client.inject(['notebook'], child => {
  child.notebook.current()
  child.inject(['noteAssets'], nested => {
    nested.noteAssets.upload(new File([], 'nested.png'))
    // @ts-expect-error Nested client contexts cannot access backend storage.
    nested.noteAssets.directory
  })
})
client.inject(['notebook'], (child: ClientContext) => { child.notebook.current() })
server.inject(['notes'], child => {
  child.notes.list()
  // @ts-expect-error Backend child contexts cannot access the browser notebook.
  child.notebook.current()
})
client.plugin(child => {
  child.notebook.current()
  child.plugin(nested => {
    nested.notebook.current()
    // @ts-expect-error Nested client plugins must not acquire backend services.
    nested.notes.list()
  })
})
server.plugin({ apply(child) { child.notes.list() } })
const configured = (child: ServerContext, config: { title: string }) => {
  child.notes.create()
  return config.title
}
server.plugin(configured, { title: 'sample' })
// @ts-expect-error Required plugin configuration remains required.
server.plugin(configured)
// @ts-expect-error Configuration must keep the plugin's declared shape.
server.plugin(configured, { title: 1 })
class ChildPlugin {
  constructor(child: ServerContext, config: { title: string }) { child.notes.create(); void config.title }
}
server.plugin(ChildPlugin, { title: 'sample' })
// @ts-expect-error Constructor plugins still require their configuration.
server.plugin(ChildPlugin)
declare const configuredObject: Plugin.Base<{ title: string }> & { apply(ctx: ServerContext, config: { title: string }): void }
server.plugin(configuredObject, { title: 'sample' })
// @ts-expect-error Object plugins still require their configuration.
server.plugin(configuredObject)
// @ts-expect-error Object plugins also preserve their configuration shape.
server.plugin(configuredObject, { title: 123 })
client.extend().notebook.current()
server.isolate('notes').notes.list()
const nativeContext: Context = client
declare const nativePlugin: Plugin
client.plugin(nativePlugin)
void nativeContext

const routeResult: void = server.http.route(server, 'GET', /^\/sample$/, () => ({ ok: true }))
// @ts-expect-error Routes are cleaned up by their owner, not by a returned function.
routeResult()
