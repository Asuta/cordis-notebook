export function orderedProviders(providers) {
  return [...providers].sort((a, b) => {
    const preferred = Number(b.defaultProvider === true) - Number(a.defaultProvider === true)
    if (preferred) return preferred
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
  })
}

export function defaultProvider(providers) {
  return orderedProviders(providers)[0]
}
