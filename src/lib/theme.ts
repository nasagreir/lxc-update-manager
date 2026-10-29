export const THEME_STORAGE_KEY = "lxc-updater-theme";

export const THEMES = ["light", "dark", "ultra-dark"] as const;

export type Theme = (typeof THEMES)[number];

export function isTheme(value: unknown): value is Theme {
  return (
    typeof value === "string" &&
    (THEMES as readonly string[]).includes(value)
  );
}

/** Apply theme classes on <html>. Ultra dark also sets .dark for utility variants. */
export function applyThemeClass(theme: Theme) {
  const root = document.documentElement;
  root.classList.remove("dark", "ultra-dark");
  if (theme === "dark") {
    root.classList.add("dark");
  } else if (theme === "ultra-dark") {
    root.classList.add("dark", "ultra-dark");
  }
}

export const THEME_LABELS: Record<Theme, string> = {
  light: "Light",
  dark: "Dark",
  "ultra-dark": "Ultra dark",
};

/** Inline bootstrap script — keeps first paint matching stored preference. */
export const THEME_BOOTSTRAP_SCRIPT = `(function(){try{var k=${JSON.stringify(THEME_STORAGE_KEY)};var t=localStorage.getItem(k)||"light";var r=document.documentElement;r.classList.remove("dark","ultra-dark");if(t==="dark")r.classList.add("dark");else if(t==="ultra-dark"){r.classList.add("dark","ultra-dark");}}catch(e){}})();`;
