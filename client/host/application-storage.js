/** A small Storage-compatible namespace. Values remain owned by the plugin. */
export function applicationStorage(storage, applicationId, pluginId) {
  const prefix = `cordis:app:${applicationId}:plugin:${pluginId}:`
  const keys = () => Array.from({ length: storage.length }, (_, i) => storage.key(i)).filter(key => key?.startsWith(prefix)).map(key => key.slice(prefix.length))
  return {
    get length() { return keys().length },
    key(index) { return keys()[index] ?? null },
    getItem(key) { return storage.getItem(prefix + key) },
    setItem(key, value) { storage.setItem(prefix + key, value) },
    removeItem(key) { storage.removeItem(prefix + key) },
    clear() { for (const key of keys()) storage.removeItem(prefix + key) },
  }
}
