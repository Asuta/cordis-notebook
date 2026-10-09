export interface ThemeColors {
  readonly background: string
  readonly surface: string
  readonly panel: string
  readonly text: string
  readonly muted: string
  readonly border: string
  readonly accent: string
  readonly selected: string
  readonly onAccent: string
  /** Omit to derive a readable emphasis color for surface/panel/selected. */
  readonly accentText?: string
}
export interface ThemePreset {
  readonly id: string
  readonly name: string
  readonly colors: ThemeColors | readonly [string, string, string, string, string, string, string, string]
  readonly dark?: boolean
}
export interface ThemeSelection { readonly id: string; readonly dark?: boolean }
