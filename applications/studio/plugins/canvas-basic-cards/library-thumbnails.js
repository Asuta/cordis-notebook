// One bounded poster cache/decoder queue shared by every library window.
// Data URLs remain usable by mounted images even after their cache entry expires.
export function createVideoThumbnails(document) {
  const cache = new Map(), jobs = new Map()
  let bytes = 0, active = 0, stopped = false
  function remember(url, src) {
    const entry = { src, retryAt: src ? Infinity : Date.now() + 30000, bytes: (src?.length || 0) * 2 }
    bytes -= cache.get(url)?.bytes || 0; cache.delete(url); cache.set(url, entry); bytes += entry.bytes
    while (cache.size > 200 || bytes > 8 * 1024 * 1024) { const key = cache.keys().next().value; bytes -= cache.get(key).bytes; cache.delete(key) }
  }
  function pump() {
    if (stopped) return
    for (const job of jobs.values()) {
      if (active >= 2) break
      if (job.started || !job.listeners.size) continue
      job.started = true; active++
      const video = document.createElement('video')
      video.muted = true; video.playsInline = true; video.preload = 'auto'
      let done = false, timer
      const finish = (src, cancelled = false) => {
        if (done) return
        done = true; clearTimeout(timer)
        video.onloadedmetadata = video.onloadeddata = video.onseeked = video.onerror = null
        video.pause(); video.removeAttribute('src'); video.load()
        jobs.delete(job.url); active--
        if (!cancelled && !stopped) { remember(job.url, src); for (const listener of job.listeners) listener(src) }
        queueMicrotask(pump)
      }
      job.cancel = () => finish(null, true)
      const capture = () => {
        if (done || video.seeking || video.readyState < 2 || !video.videoWidth) return
        try {
          const canvas = document.createElement('canvas'), scale = Math.min(1, 240 / Math.max(video.videoWidth, video.videoHeight))
          canvas.width = Math.max(1, Math.round(video.videoWidth * scale)); canvas.height = Math.max(1, Math.round(video.videoHeight * scale))
          canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height)
          finish(canvas.toDataURL('image/webp', .75))
        } catch { finish(null) }
      }
      video.onloadedmetadata = () => { if (Number.isFinite(video.duration) && video.duration > 0) video.currentTime = Math.min(.1, video.duration / 2) }
      video.onloadeddata = video.onseeked = capture
      video.onerror = () => finish(null)
      timer = setTimeout(() => finish(null), 12000)
      video.src = job.url
    }
  }
  return {
    request(url, listener) {
      if (stopped) return () => {}
      const entry = cache.get(url)
      if (entry && entry.retryAt > Date.now()) { cache.delete(url); cache.set(url, entry); listener(entry.src); return () => {} }
      let job = jobs.get(url)
      if (!job) { job = { url, listeners: new Set(), started: false }; jobs.set(url, job) }
      job.listeners.add(listener); pump()
      return () => { job.listeners.delete(listener); if (!job.listeners.size) { if (job.cancel) job.cancel(); else jobs.delete(url) } }
    },
    dispose() { stopped = true; for (const job of jobs.values()) job.cancel?.(); jobs.clear(); cache.clear(); bytes = 0 },
  }
}
