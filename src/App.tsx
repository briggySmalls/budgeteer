import { useCallback, useEffect, useRef, useState } from "react";
import { Dashboard } from "./components/Dashboard";
import { type ParsedInputs, loadInputs } from "./ingest";
import { BudgeteerError } from "./models";
import { requestAccessToken } from "./sources/googleAuth";
import { pickSpreadsheet } from "./sources/googlePicker";
import { GoogleSheetsSource } from "./sources/googleSheets";
import {
  clearSessionToken,
  getSessionToken,
  getStoredSheetId,
  setSessionToken,
  setStoredSheetId,
} from "./storage";
import { useTheme } from "./theme";

const CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID;
const API_KEY = import.meta.env.VITE_GOOGLE_API_KEY;
const GOOGLE_ENABLED = Boolean(CLIENT_ID && API_KEY);

interface GoogleSession {
  token: string;
  sheetId: string;
}

type State =
  | { status: "empty" }
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; inputs: ParsedInputs; google: GoogleSession };

function errorMessage(e: unknown): string {
  if (e instanceof BudgeteerError) {
    return e.message;
  }
  return `Could not load model: ${e instanceof Error ? e.message : String(e)}`;
}

export function App() {
  const [state, setState] = useState<State>({ status: "empty" });
  const { theme, toggle } = useTheme();
  const autoRestored = useRef(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    }
    if (menuOpen) {
      document.addEventListener("click", handleClick);
    }
    return () => document.removeEventListener("click", handleClick);
  }, [menuOpen]);

  const loadSheet = useCallback(async (token: string, sheetId: string) => {
    setState({ status: "loading" });
    try {
      const inputs = await loadInputs(
        new GoogleSheetsSource({ spreadsheetId: sheetId, accessToken: token })
      );
      setStoredSheetId(sheetId);
      setState({ status: "ready", inputs, google: { token, sheetId } });
    } catch (e) {
      setState({ status: "error", message: errorMessage(e) });
    }
  }, []);

  const pick = useCallback(
    async (token: string, onCancel: () => void) => {
      if (!API_KEY) {
        return;
      }
      const picked = await pickSpreadsheet(token, API_KEY);
      if (picked) {
        await loadSheet(token, picked.id);
      } else {
        onCancel();
      }
    },
    [loadSheet]
  );

  const connectGoogle = useCallback(async () => {
    if (!CLIENT_ID) {
      return;
    }
    setState({ status: "loading" });
    try {
      const { token, expiresIn } = await requestAccessToken(CLIENT_ID);
      setSessionToken(token, expiresIn);
      const stored = getStoredSheetId();
      if (stored) {
        await loadSheet(token, stored);
      } else {
        await pick(token, () => setState({ status: "empty" }));
      }
    } catch (e) {
      clearSessionToken();
      setState({ status: "error", message: errorMessage(e) });
    }
  }, [loadSheet, pick]);

  // Auto-restore a valid session on page load.
  useEffect(() => {
    if (autoRestored.current || !GOOGLE_ENABLED) {
      return;
    }
    autoRestored.current = true;
    const token = getSessionToken();
    const sheetId = getStoredSheetId();
    if (token && sheetId) {
      void loadSheet(token, sheetId);
    }
  }, [loadSheet]);

  return (
    <div className="app">
      <header className="app-header">
        <h1>Budgeteer — Liquidity Forecast</h1>
        <div className="header-actions">
          {state.status === "ready" && (
            <div className="menu-container" ref={menuRef}>
              <button
                type="button"
                className="menu-btn"
                onClick={() => setMenuOpen((o) => !o)}
                aria-label="Menu"
                aria-expanded={menuOpen}
              >
                ☰
              </button>
            </div>
          )}
          <button type="button" className="theme-toggle" onClick={toggle} aria-label="Toggle theme">
            {theme === "dark" ? "☀" : "☾"}
          </button>
        </div>
      </header>

      {state.status === "ready" && menuOpen && (
        <>
          <div
            className="menu-backdrop"
            role="button"
            tabIndex={-1}
            onClick={() => setMenuOpen(false)}
            onKeyUp={(e) => {
              if (e.key === "Escape") setMenuOpen(false);
            }}
          />
          <aside className="menu-tray">
            <div className="menu-tray-header">
              <h2>Menu</h2>
              <button
                type="button"
                className="menu-close"
                onClick={() => setMenuOpen(false)}
                aria-label="Close menu"
              >
                ✕
              </button>
            </div>
            <button
              type="button"
              className="menu-item"
              onClick={() => {
                setMenuOpen(false);
                void loadSheet(state.google.token, state.google.sheetId);
              }}
            >
              Refresh from Sheet
            </button>
            <button
              type="button"
              className="menu-item"
              onClick={() => {
                setMenuOpen(false);
                void pick(state.google.token, () => {});
              }}
            >
              Choose a different sheet
            </button>
            <hr className="menu-divider" />
            <button
              type="button"
              className="menu-item"
              onClick={() => {
                setMenuOpen(false);
                clearSessionToken();
                setState({ status: "empty" });
              }}
            >
              Logout
            </button>
          </aside>
        </>
      )}

      {state.status === "ready" ? (
        <Dashboard inputs={state.inputs} />
      ) : (
        <div className="upload">
          <button
            type="button"
            className="connect"
            onClick={() => void connectGoogle()}
            disabled={!GOOGLE_ENABLED || state.status === "loading"}
          >
            Connect Google Sheets
          </button>
          {!GOOGLE_ENABLED && (
            <p className="hint">
              Set <code>VITE_GOOGLE_CLIENT_ID</code> and <code>VITE_GOOGLE_API_KEY</code> to enable
              Google Sheets.
            </p>
          )}

          {state.status === "loading" && <p>Loading…</p>}
          {state.status === "error" && <p className="error">{state.message}</p>}
        </div>
      )}
    </div>
  );
}
