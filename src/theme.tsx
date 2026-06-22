import {
  type ReactNode,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { getStoredTheme, setStoredTheme } from "./storage";

type Theme = "light" | "dark";

function systemTheme(): Theme {
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function subscribe(onChange: () => void): () => void {
  const mql = window.matchMedia("(prefers-color-scheme: dark)");
  mql.addEventListener("change", onChange);
  return () => mql.removeEventListener("change", onChange);
}

interface ThemeContextValue {
  theme: Theme;
  toggle: () => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    throw new Error("useTheme must be used within ThemeProvider");
  }
  return ctx;
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const live = useSyncExternalStore(subscribe, systemTheme);
  const [override, setOverride] = useState<Theme | null>(() => getStoredTheme(null));

  const effective = override ?? live;
  const overrideRef = useRef(override);
  overrideRef.current = override;

  useEffect(() => {
    document.documentElement.dataset.theme = effective;
  }, [effective]);

  useEffect(() => {
    if (overrideRef.current !== null && live === overrideRef.current) {
      setStoredTheme(null);
      setOverride(null);
    }
  }, [live]);

  const toggle = useCallback(() => {
    const next: Theme = effective === "dark" ? "light" : "dark";
    if (next === live) {
      setStoredTheme(null);
      setOverride(null);
    } else {
      setStoredTheme(next);
      setOverride(next);
    }
  }, [effective, live]);

  return (
    <ThemeContext.Provider value={{ theme: effective, toggle }}>{children}</ThemeContext.Provider>
  );
}
