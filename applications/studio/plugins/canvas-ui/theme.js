import { useSyncExternalStore } from "react";
let theme = "dark";
const listeners = new Set();
export function setTheme(value) {
  theme = value;
  for (const listener of listeners) listener();
}
const subscribe = (listener) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};
export const useThemeStore = (selector) =>
  useSyncExternalStore(subscribe, () => selector({ theme, setTheme }));
