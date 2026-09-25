// Compatibility entry for tools/tests; discovery does not execute plugin code.
import { discoverBuiltins } from './plugin-discovery.js'
export { discoverBuiltins } from './plugin-discovery.js'
export const builtins = await discoverBuiltins()
