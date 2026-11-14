import { PARAMS, LIVE_EXPRESSIONS, validateRig } from './compiled/runtime.js'

const labels = { angleX: '左右转头', angleY: '抬头低头', angleZ: '歪头', bodyAngleX: '身体转向', bodyAngleZ: '身体倾斜', breath: '呼吸', eyeLOpen: '左眼开合', eyeROpen: '右眼开合', eyeSmile: '笑眼', gazeX: '左右视线', gazeY: '上下视线', browY: '眉毛高低', browAngle: '眉毛角度', mouthOpen: '嘴巴开合', mouthForm: '嘴型', blush: '脸红', armAngle: '手臂角度', handAngle: '手腕角度', fingerTap: '指尖', weightShift: '重心' }
export const meshParameters = () => PARAMS.map(p => ({ id: p.id, label: labels[p.id] || p.label, min: p.min, max: p.max, default: p.def, step: .01 }))
export function meshModel({ id, name, revision = 1, editorProject = id, nativeRig, manifest }) {
  return { schemaVersion: 1, engine: 'mesh-avatar', id, name, revision, editorProject, sourceAssetId: '', nativeRig, manifest, rig: { schemaVersion: 'mesh-avatar/1', stage: { width: nativeRig.image.width, height: nativeRig.image.height }, assets: [], parameters: meshParameters() }, expressions: LIVE_EXPRESSIONS.map(id => ({ id, name: ({ neutral: '自然', smile: '微笑', shy: '害羞', surprise: '惊讶', halfLidded: '半睁眼', angry: '生气', sad: '难过', wink: '眨单眼' })[id], values: {} })), motions: [{ id: 'greeting', name: '轻轻点头', duration: 1800, tracks: [{ parameter: 'angleY', keys: [{ at: 0, value: 0 }, { at: .35, value: -12 }, { at: .7, value: 5 }, { at: 1, value: 0 }] }] }] }
}
export function validateMeshModel(m) {
  const idOK = id => typeof id === 'string' && /^[a-z0-9-]{1,80}$/i.test(id)
  if (m?.schemaVersion !== 1 || m.engine !== 'mesh-avatar' || !idOK(m.id) || !idOK(m.editorProject) || !Number.isSafeInteger(m.revision) || m.revision < 1 || typeof m.name !== 'string' || !m.name.trim() || m.name.length > 120) throw Object.assign(Error('Mesh Avatar 模型信息无效'), { status: 400 })
  const issues = validateRig(m.nativeRig)
  if (issues.length) throw Object.assign(Error('Mesh Avatar 绑定无效：' + issues.join('; ')), { status: 400 })
  return meshModel(m)
}
