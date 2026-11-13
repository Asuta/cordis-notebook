# Mesh Avatar Studio integration

Upstream: https://github.com/shinshin86/mesh-avatar-studio
Pinned commit: 3619620266740236327debfcf327f898a99dd7b3
Runtime: mesh-avatar 0.7.2. Code license: MIT (vendor/LICENSE).

vendor/src, vendor/packages/runtime/src, vendor/tools and vendor/samples are
unmodified upstream source and sample snapshots. The Miko character has separate
terms in vendor/samples/miko-qipao/MIKO_ASSET_TERMS.md. It is included as part of
this visual novel application; no official affiliation is implied.

Build with: node applications/novel/plugins/game/scripts/build-mesh-avatar.mjs
The build adapter scopes local project URLs to the current story, enables the
local project API in the embedded build, adds the editor/Agent bridge and sends
the upstream live-preview link back to this application's game preview. The
original renderer, rig algorithms, model editor and layer-building tools remain
upstream implementations. Camera/live broadcasting is outside this integration.

Layer rebuilds use uv and Python 3.10–3.13 with numpy, pillow and
opencv-python-headless, as in upstream. Bundled Miko playback requires none of
these tools and uses local assets only.
