import { useCallback, useState } from "react";
import { Dashboard } from "./components/Dashboard";
import { SheetPicker } from "./components/SheetPicker";
import { type ParsedInputs, loadInputs } from "./ingest";
import { BudgeteerError } from "./models";
import { type SpreadsheetRef, listSpreadsheets, requestAccessToken } from "./sources/googleAuth";
import { GoogleSheetsSource } from "./sources/googleSheets";
import { OdsUploadSource } from "./sources/odsUpload";
import { getStoredSheetId, setStoredSheetId } from "./storage";

const CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID;

type State =
  | { status: "empty" }
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "choosing"; token: string; sheets: SpreadsheetRef[] }
  | { status: "ready"; inputs: ParsedInputs; onRefresh?: () => void };

function errorMessage(e: unknown): string {
  if (e instanceof BudgeteerError) {
    return e.message;
  }
  return `Could not load model: ${e instanceof Error ? e.message : String(e)}`;
}

export function App() {
  const [state, setState] = useState<State>({ status: "empty" });

  const onFile = useCallback(async (file: File) => {
    setState({ status: "loading" });
    try {
      const inputs = await loadInputs(await OdsUploadSource.fromFile(file));
      setState({ status: "ready", inputs });
    } catch (e) {
      setState({ status: "error", message: errorMessage(e) });
    }
  }, []);

  const loadSheet = useCallback(async (token: string, spreadsheetId: string) => {
    setState({ status: "loading" });
    try {
      const inputs = await loadInputs(
        new GoogleSheetsSource({ spreadsheetId, accessToken: token })
      );
      setStoredSheetId(spreadsheetId);
      setState({
        status: "ready",
        inputs,
        onRefresh: () => void loadSheet(token, spreadsheetId),
      });
    } catch (e) {
      setState({ status: "error", message: errorMessage(e) });
    }
  }, []);

  const connectGoogle = useCallback(async () => {
    if (!CLIENT_ID) {
      return;
    }
    setState({ status: "loading" });
    try {
      const token = await requestAccessToken(CLIENT_ID);
      const sheets = await listSpreadsheets(token);
      const stored = getStoredSheetId();
      if (stored && sheets.some((s) => s.id === stored)) {
        await loadSheet(token, stored);
      } else {
        setState({ status: "choosing", token, sheets });
      }
    } catch (e) {
      setState({ status: "error", message: errorMessage(e) });
    }
  }, [loadSheet]);

  return (
    <div className="app">
      <header className="app-header">
        <h1>Budgeteer — Liquidity Forecast</h1>
      </header>

      {state.status === "ready" && (
        <Dashboard
          inputs={state.inputs}
          onReset={() => setState({ status: "empty" })}
          onRefresh={state.onRefresh}
        />
      )}

      {state.status === "choosing" && (
        <SheetPicker sheets={state.sheets} onOpen={(id) => void loadSheet(state.token, id)} />
      )}

      {(state.status === "empty" || state.status === "loading" || state.status === "error") && (
        <div className="upload">
          <button
            type="button"
            className="connect"
            onClick={() => void connectGoogle()}
            disabled={!CLIENT_ID || state.status === "loading"}
          >
            Connect Google Sheets
          </button>
          {!CLIENT_ID && (
            <p className="hint">
              Set <code>VITE_GOOGLE_CLIENT_ID</code> to enable Google Sheets.
            </p>
          )}

          <p className="hint">or</p>

          <label className="upload-label">
            Upload a <code>.ods</code> file
            <input
              type="file"
              accept=".ods"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) {
                  void onFile(file);
                }
              }}
            />
          </label>

          {state.status === "loading" && <p>Loading…</p>}
          {state.status === "error" && <p className="error">{state.message}</p>}
        </div>
      )}
    </div>
  );
}
