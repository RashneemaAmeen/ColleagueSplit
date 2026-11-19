"use client";

import * as React from "react";
import { Segmented } from "@/components/ui/primitives";

type Theme = "light" | "dark" | "system";
const KEY = "cs:theme";

/** Inline script (rendered in <head>) that applies the theme before first paint. */
export const themeInitScript = `(function(){try{var t=localStorage.getItem('${KEY}')||'system';var d=t==='dark'||(t==='system'&&matchMedia('(prefers-color-scheme: dark)').matches);document.documentElement.classList.toggle('dark',d);}catch(e){}})();`;

function apply(theme: Theme) {
  const dark = theme === "dark" || (theme === "system" && matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.classList.toggle("dark", dark);
}

export function ThemeToggle() {
  const [theme, setTheme] = React.useState<Theme>("system");
  React.useEffect(() => {
    try {
      setTheme((localStorage.getItem(KEY) as Theme) || "system");
    } catch {
      /* ignore */
    }
  }, []);
  const change = (t: Theme) => {
    setTheme(t);
    try {
      localStorage.setItem(KEY, t);
    } catch {
      /* ignore */
    }
    apply(t);
  };
  return (
    <Segmented<Theme>
      label="Theme"
      value={theme}
      onChange={change}
      options={[
        { value: "light", label: "Light" },
        { value: "dark", label: "Dark" },
        { value: "system", label: "Auto" },
      ]}
    />
  );
}
