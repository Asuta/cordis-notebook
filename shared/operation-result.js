/** Mutation responses expose only confirmation data owned by this operation. */
export function operationResult(snapshot, operation) {
  const owns = pending => operation.status === 'awaiting-client' && pending?.operationId === operation.id
  const { preview, ...state } = snapshot
  const pendingConfig = owns(state.pendingConfig) ? state.pendingConfig : null
  return { ...state, pendingSwitch: owns(state.pendingSwitch) ? state.pendingSwitch : null, pendingConfig,
    ...(pendingConfig && preview ? { preview } : {}), operation }
}
