import { createSession } from './session.js'
export default async function (ctx, sdk) { sdk.provide('canvasSession', await createSession(ctx, sdk)) }
