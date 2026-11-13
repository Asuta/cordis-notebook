import { el } from './ui.js'

const svg = body => 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(body)

// 原创矢量插画是可离线使用的默认场景；创作者可以在编辑器上传自己的立绘和背景。
const portrait = svg('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 900"><defs><linearGradient id="wall" x2="1" y2="1"><stop stop-color="#243733"/><stop offset="1" stop-color="#596551"/></linearGradient><linearGradient id="coat" x2="1" y2="1"><stop stop-color="#86917a"/><stop offset="1" stop-color="#354d43"/></linearGradient><linearGradient id="skin" x2="1" y2=".5"><stop stop-color="#edccb0"/><stop offset="1" stop-color="#c7957a"/></linearGradient><radialGradient id="light"><stop stop-color="#e7ba78" stop-opacity=".45"/><stop offset="1" stop-color="#e7ba78" stop-opacity="0"/></radialGradient></defs><path fill="url(#wall)" d="M0 0h600v900H0z"/><circle cx="470" cy="120" r="280" fill="url(#light)"/><path d="M42 0v500M151 0v500M560 0v500M0 190h600M0 350h600" stroke="#cbb586" stroke-opacity=".12" stroke-width="8"/><g fill="#1d2b29"><path d="M12 356h578v24H12zM28 216h22v138H28zM54 238h15v116H54zM74 222h36v132H74zM113 245h20v109h-20zM440 248h25v106h-25zM470 226h18v128h-18zM496 236h27v118h-27zM528 205h40v149h-40z"/></g><path fill="#262b29" d="M191 225c-9-131 203-172 231-25 8 54-13 95 8 155l-28 135-230-10 13-157z"/><path fill="url(#skin)" d="m264 349-5 75-49 26 86 84 85-82-53-28-4-80z"/><path fill="url(#skin)" d="M221 230c-6-107 151-127 160-16l-6 87c-5 59-49 95-75 94-35-1-73-38-79-93z"/><path fill="#252c29" d="M203 268c-19-46-13-134 62-155 71-20 129 21 132 94 0 24-7 44-15 65l-12-53c-47 15-81-12-90-40-9 32-36 46-59 55l-2 48z"/><path d="M235 265q19-12 34-3M322 262q20-11 36 0" fill="none" stroke="#594b40" stroke-width="4" stroke-linecap="round"/><path d="M240 278q12-7 24 0M327 277q12-7 24 0" fill="none" stroke="#323c36" stroke-width="4" stroke-linecap="round"/><circle cx="253" cy="279" r="4" fill="#34433a"/><circle cx="339" cy="278" r="4" fill="#34433a"/><path d="m297 280-8 37 13 3M277 345q20 13 39-1" stroke="#a16f60" stroke-width="3" fill="none" stroke-linecap="round"/><ellipse cx="246" cy="311" rx="18" ry="7" fill="#c98977" opacity=".25"/><ellipse cx="345" cy="311" rx="18" ry="7" fill="#c98977" opacity=".25"/><path fill="url(#coat)" d="m211 431 52-18 35 49 32-49 61 20c59 16 78 47 89 117l42 243-85 30-16-82-10 159H167l-9-148-17 69-79-32 51-248c12-63 41-91 98-110z"/><path fill="#d9d0b9" d="m263 414 35 48 32-48 25 35-57 142-59-141z"/><path fill="#5b7162" d="m209 431 44-17-22 48 35 30-56 123-35-100zM383 430l-44-16 24 48-37 30 55 123 39-100z"/><path d="M298 576v324M173 701l35 13M390 714l35-14" stroke="#233e34" stroke-width="3" opacity=".5"/><g transform="rotate(-12 302 644)"><rect x="182" y="534" width="248" height="253" rx="4" fill="#d5b887"/><rect x="196" y="548" width="220" height="225" fill="#e6d2af"/><circle cx="307" cy="656" r="88" fill="#27322e"/><circle cx="307" cy="656" r="63" fill="none" stroke="#778176" stroke-width="1"/><circle cx="307" cy="656" r="49" fill="none" stroke="#778176" stroke-width="1"/><circle cx="307" cy="656" r="24" fill="#ad7754"/><circle cx="307" cy="656" r="5" fill="#d5c5a0"/></g><path d="m119 658 77 49 33-19 33 12 19 33-52 34-39-2-91-45z" fill="url(#skin)"/><path d="m437 631-43 65-29-7-22 14-4 36 43 18 36-9 64-77z" fill="url(#skin)"/><path d="M207 715l32 17M208 729l26 14M365 708l22 11M359 720l23 13" fill="none" stroke="#b78470" stroke-width="2"/><path d="M0 833q300-32 600 0v67H0z" fill="#172a25" opacity=".22"/></svg>')

const background = svg('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1600 1000"><defs><linearGradient id="bg" y2="1"><stop stop-color="#142b2d"/><stop offset="1" stop-color="#2c3833"/></linearGradient><radialGradient id="glow"><stop stop-color="#dbaa62" stop-opacity=".6"/><stop offset="1" stop-color="#dbaa62" stop-opacity="0"/></radialGradient><pattern id="rain" width="65" height="90" patternUnits="userSpaceOnUse"><path d="m25 0-18 70m50-30L43 90" stroke="#b5d4d0" stroke-opacity=".18"/></pattern></defs><path fill="url(#bg)" d="M0 0h1600v1000H0z"/><path fill="#203b3f" d="M50 80h610v690H50z"/><path fill="url(#rain)" d="M50 80h610v690H50z"/><path d="M255 80v690M460 80v690M50 430h610" stroke="#12272a" stroke-width="18"/><circle cx="990" cy="290" r="550" fill="url(#glow)"/><path d="M1010 0v150M925 190l85-45 85 45z" stroke="#a68a5d" stroke-width="5" fill="#c29a61"/><path d="M760 390h750v20H760zm0 240h750v20H760z" fill="#a38356" opacity=".4"/><g fill="#bd9e70" opacity=".2"><path d="M780 215h29v175h-29zm40 20h20v155h-20zm32-40h46v195h-46zm350 43h28v152h-28zm40-40h20v192h-20zm30 18h46v174h-46zm-440 240h29v174h-29zm40 22h20v152h-20zm32-40h46v192h-46zm160 5h32v187h-32zm44 29h22v158h-22zm38-20h38v178h-38z"/></g><path d="M0 880q800-160 1600 0v120H0z" fill="#1b2925"/><ellipse cx="515" cy="800" rx="145" ry="20" fill="#b99560" opacity=".3"/><path d="M480 741h58v48q-28 18-58 0z" fill="#cbb68a" opacity=".5"/><path d="M540 750q35 0 10 25" stroke="#cbb68a" stroke-width="8" fill="none" opacity=".5"/></svg>')

export function artFor(project, type) {
  const value = project.presentation?.[type]
  return typeof value === 'string' && /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(value) ? value : type === 'portrait' ? portrait : background
}

export function applyAtmosphere(root, project) {
  root.dataset.theme = project.presentation?.theme || 'amber'
  root.style.setProperty('--rp-scene-image', 'url("' + artFor(project, 'background') + '")')
}

export function narrative(text) {
  const root = el('div', 'rp-narrative')
  for (const paragraph of String(text || '').split(/\n\s*\n/)) {
    const node = el('p')
    const pattern = /\*([^*\n]+)\*|「([^」]+)」|“([^”]+)”|"([^"\n]+)"/g
    let start = 0
    for (const match of paragraph.matchAll(pattern)) {
      node.append(document.createTextNode(paragraph.slice(start, match.index)))
      node.append(match[1] ? el('em', 'rp-narration', match[1]) : el('span', 'rp-dialogue', match[0]))
      start = match.index + match[0].length
    }
    node.append(document.createTextNode(paragraph.slice(start)))
    root.append(node)
  }
  return root
}

export function renderScene(project, opening = project.opening) {
  const image = el('img', 'rp-scene-portrait')
  image.src = artFor(project, 'portrait')
  image.alt = project.character.name + '的角色立绘'
  const root = el('aside', 'rp-scene', image,
    el('div', 'rp-scene-top', el('span', 'rp-scene-badge', '自由角色扮演'), el('span', 'rp-scene-index', '01 / STORY')),
    el('div', 'rp-scene-caption', el('span', 'rp-eyebrow', opening?.location || '此刻，在这里'), el('h2', '', project.character.name),
      el('p', 'rp-scene-description', project.character.description), el('span', 'rp-scene-time', opening?.time || '故事正在继续')))
  return root
}
