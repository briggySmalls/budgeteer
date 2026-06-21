import { useState } from "react";
import type { SpreadsheetRef } from "../sources/googleAuth";
import { getStoredSheetId } from "../storage";

interface Props {
  sheets: SpreadsheetRef[];
  onOpen: (id: string) => void;
}

export function SheetPicker({ sheets, onOpen }: Props) {
  const stored = getStoredSheetId();
  const preset = stored && sheets.some((s) => s.id === stored) ? stored : (sheets[0]?.id ?? "");
  const [selected, setSelected] = useState(preset);

  if (sheets.length === 0) {
    return <p>No spreadsheets found in your Google Drive.</p>;
  }

  return (
    <div className="upload">
      <label className="field">
        Choose your budget spreadsheet
        <select value={selected} onChange={(e) => setSelected(e.target.value)}>
          {sheets.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </label>
      <button type="button" onClick={() => onOpen(selected)} disabled={!selected}>
        Open
      </button>
    </div>
  );
}
