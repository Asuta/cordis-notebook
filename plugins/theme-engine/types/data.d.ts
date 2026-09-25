export interface ThemePreset {
  readonly id: string
  readonly name: string
  readonly colors: readonly [string, string, string, string, string, string, string, string]
  readonly dark?: boolean
}
export interface ThemeSelection { readonly id: string }
