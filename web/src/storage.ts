const SHEET_ID_KEY = "budgeteer.spreadsheetId";

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
