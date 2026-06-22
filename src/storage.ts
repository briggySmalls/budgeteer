const SHEET_ID_KEY = "budgeteer.spreadsheetId";
const THEME_KEY = "budgeteer.theme";

/** Persist the chosen Google spreadsheet id in the browser (per device). */
export function getStoredSheetId(): string | null {
  try {
    return localStorage.getItem(SHEET_ID_KEY);
  } catch {
    return null;
  }
}

export function setStoredSheetId(id: string): void {
  try {
    localStorage.setItem(SHEET_ID_KEY, id);
  } catch {
    // localStorage unavailable (private mode etc.) — non-fatal.
  }
}

export function clearStoredSheetId(): void {
  try {
    localStorage.removeItem(SHEET_ID_KEY);
  } catch {
    // non-fatal
  }
}

export function getStoredTheme<T>(fallback: T): "light" | "dark" | T {
  try {
    const v = localStorage.getItem(THEME_KEY);
    return v === "light" || v === "dark" ? v : fallback;
  } catch {
    return fallback;
  }
}

export function setStoredTheme(value: "light" | "dark" | null): void {
  try {
    if (value === null) {
      localStorage.removeItem(THEME_KEY);
    } else {
      localStorage.setItem(THEME_KEY, value);
    }
  } catch {
    // non-fatal
  }
}
