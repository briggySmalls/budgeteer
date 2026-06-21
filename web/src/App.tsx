import { useCallback, useState } from "react";
import { Dashboard } from "./components/Dashboard";
import { type ParsedInputs, loadInputs } from "./ingest";
import { BudgeteerError } from "./models";
import { OdsUploadSource } from "./sources/odsUpload";

type State =
  | { status: "empty" }
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; inputs: ParsedInputs };

export function App() {
  const [state, setState] = useState<State>({ status: "empty" });

  const onFile = useCallback(async (file: File) => {
    setState({ status: "loading" });
    try {
      const source = await OdsUploadSource.fromFile(file);
      const inputs = await loadInputs(source);
      setState({ status: "ready", inputs });
    } catch (e) {
      const message =
        e instanceof BudgeteerError
          ? e.message
          : `Could not read file: ${e instanceof Error ? e.message : String(e)}`;
      setState({ status: "error", message });
    }
  }, []);

  return (
    <div className="app">
      <header className="app-header">
        <h1>Budgeteer — Liquidity Forecast</h1>
      </header>

      {state.status === "ready" ? (
        <Dashboard inputs={state.inputs} onReset={() => setState({ status: "empty" })} />
      ) : (
        <div className="upload">
          <label className="upload-label">
            Upload your <code>model_inputs.ods</code>
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
          {state.status === "loading" && <p>Reading…</p>}
          {state.status === "error" && <p className="error">{state.message}</p>}
        </div>
      )}
    </div>
  );
}
