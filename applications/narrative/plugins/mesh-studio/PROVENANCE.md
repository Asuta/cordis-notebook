# Mesh Avatar Studio integration

Upstream: https://github.com/shinshin86/mesh-avatar-studio
Pinned commit: 3619620266740236327debfcf327f898a99dd7b3
Runtime: mesh-avatar 0.7.2. Code license: MIT (vendor/LICENSE).

vendor/src, vendor/packages/runtime/src, vendor/tools and vendor/samples are
unmodified upstream source and sample snapshots. The Miko character has separate
terms in vendor/samples/miko-qipao/MIKO_ASSET_TERMS.md. It is included as part of
the narrative application; no official affiliation is implied.

Ported from the d89d CordisTest worktree (novel game mesh-avatar integration).
Build with: pnpm --filter @cordis-narrative/mesh-studio prepare:studio
The build adapter scopes local project URLs to the current story, enables the
local project API in the embedded build, adds the editor/Agent bridge and sends
the upstream live-preview link back to this application's game preview. The
original renderer, rig algorithms, model editor and layer-building tools remain
upstream implementations. Camera/live broadcasting is outside this integration.
The preview adapter accumulates elapsed time before advancing the upstream 60 Hz
simulation, so high-refresh displays do not round every lip-sync frame down to zero.
The narrative adapter owns its Cordis lifecycle, same-origin bridge, isolated
project API, immutable archive storage and portable resource bundle hooks.
docs/agent-guide.md is application-specific guidance.

Layer rebuilds use uv and Python 3.10–3.13 with numpy, pillow and
opencv-python-headless, as in upstream. Bundled Miko playback requires none of
these tools and uses local assets only.
