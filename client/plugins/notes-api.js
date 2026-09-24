export default function(ctx, sdk) {
  sdk.provide('notesApi', { request: (path = '', method, data) => sdk.request('/api/notes' + path, method, data) })
}
