// Cordis adapters for the MIT CanvasNode component; no upstream browser database.
import React, { forwardRef } from 'react'
import messages from './node-messages.js'
export const CanvasNodeType = { Text: 'text', Image: 'image', Config: 'config', Group: 'group', Video: 'video', Audio: 'audio' }
export const useTranslation = () => ({ t(key, values = {}) {
  const value = key.split('.').reduce((item, part) => item?.[part], messages)
  return String(value ?? key).replace(/\{\{(\w+)\}\}/g, (_, name) => String(values[name] ?? ''))
} })
export const CanvasResourceMentionTextarea = forwardRef(function Textarea({ references, highlightLabels, onChange, ...props }, ref) {
  return React.createElement('textarea', { ...props, ref, onInput: event => onChange(event.target.value) })
})
// Assets have immutable URLs. The host supplies its server-generated preview URL.
export const previewUrlFor = key => key
export const subscribeImagePreviews = () => () => {}
export const getImagePreviewRevision = () => 0
export const formatBytes = bytes => bytes ? (bytes < 1048576 ? Math.round(bytes / 1024) + ' KB' : (bytes / 1048576).toFixed(1) + ' MB') : ''
