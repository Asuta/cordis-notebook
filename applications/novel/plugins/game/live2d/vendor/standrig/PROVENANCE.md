# StandRig source snapshot

Upstream: https://github.com/sayaka-aiart/StandRig

Commit: `d74c6aba9a02ba3cc33c34f7426c13d09b4bc6f5` (2026-11-06).

License: Apache-2.0, reproduced in LICENSE; upstream NOTICE is retained.
Only the transitive sources used by runtime.js are included. The upstream
files under core/ and runtime/ are unmodified. Our integration, validation,
document history, asset handling and editor live outside this directory.

Rebuild with `node applications/novel/plugins/game/scripts/vendor-standrig.mjs`.
Refresh explicitly with `--source <upstream-checkout>` and revalidate rendering.
Canvas rendering is the default; experimental WebGL is not enabled implicitly.
