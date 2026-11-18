// Test the legacy document before conversion as well as the registered format after conversion.
import { validateProject as envelope, validateRuntime as restore, compositionTools } from '../../model.js'
import { storyFormat, initialLegacyRuntime, validateLegacyRuntime, migrateStoryResources as migrate } from '../../../story-data/model.js'
export { diagnose } from '../../../story-data/model.js'
export function validateProject(p){envelope(p);storyFormat.validate(p);return p}
export function migrateStoryResources(p){validateProject(p);migrate(p,compositionTools);return validateProject(p)}
export const initialRuntime=(p,id)=>p.nodes?initialLegacyRuntime(p,id):{busy:false,error:''}
export const validateRuntime=(s,p)=>p.nodes?validateLegacyRuntime(s,p):restore(s,p,[storyFormat])
