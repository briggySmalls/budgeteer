import { useCallback, useState } from "react";
import { Dashboard } from "./components/Dashboard";
import { type ParsedInputs, loadInputs } from "./ingest";
import { BudgeteerError } from "./models";
import { requestAccessToken } from "./sources/googleAuth";
import { pickSpreadsheet } from "./sources/googlePicker";
import { GoogleSheetsSource } from "./sources/googleSheets";
import { getStoredSheetId, setStoredSheetId } from "./storage";

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
  | { status: "ready"; inputs: ParsedInputs; google?: GoogleSession };

function errorMessage(e: unknown): string {
  if (e instanceof BudgeteerError) {
    return e.message;
  }
  return `Could not load model: ${e instanceof Error ? e.message : String(e)}`;
}

export function App() {
  const [state, setState] = useState<State>({ status: "empty" });

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

  // Open the Picker; load the chosen sheet, or fall back to `onCancel`.
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
      const token = await requestAccessToken(CLIENT_ID);
      const stored = getStoredSheetId();
      if (stored) {
        await loadSheet(token, stored);
      } else {
        await pick(token, () => setState({ status: "empty" }));
      }
    } catch (e) {
      setState({ status: "error", message: errorMessage(e) });
    }
  }, [loadSheet, pick]);

  const google = state.status === "ready" ? state.google : undefined;

  return (
    <div className="app">
      <header className="app-header">
        <h1>Budgeteer — Liquidity Forecast</h1>
      </header>

      {state.status === "ready" ? (
        <Dashboard
          inputs={state.inputs}
          onReset={() => setState({ status: "empty" })}
          onRefresh={google ? () => void loadSheet(google.token, google.sheetId) : undefined}
          onPickAnother={google ? () => void pick(google.token, () => {}) : undefined}
        />
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
