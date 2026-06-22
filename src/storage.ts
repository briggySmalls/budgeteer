const SHEET_ID_KEY = "budgeteer.spreadsheetId";
const THEME_KEY = "budgeteer.theme";
const SESSION_TOKEN_KEY = "budgeteer.token";
const SESSION_EXPIRY_KEY = "budgeteer.expiresAt";

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

/** Session-level token storage (survives page refreshes, cleared on tab close). */
export function getSessionToken(): string | null {
  try {
    const token = sessionStorage.getItem(SESSION_TOKEN_KEY);
    const expiresAt = sessionStorage.getItem(SESSION_EXPIRY_KEY);
    if (token && expiresAt && Number(expiresAt) > Date.now()) {
      return token;
    }
    clearSessionToken();
    return null;
  } catch {
    return null;
  }
}

export function setSessionToken(token: string, expiresIn: number): void {
  try {
    sessionStorage.setItem(SESSION_TOKEN_KEY, token);
    sessionStorage.setItem(SESSION_EXPIRY_KEY, String(Date.now() + expiresIn * 1000));
  } catch {
    // sessionStorage unavailable — non-fatal.
  }
}

export function clearSessionToken(): void {
  try {
    sessionStorage.removeItem(SESSION_TOKEN_KEY);
    sessionStorage.removeItem(SESSION_EXPIRY_KEY);
  } catch {
    // non-fatal
  }
}
