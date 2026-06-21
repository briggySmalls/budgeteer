const GAPI_SRC = "https://apis.google.com/js/api.js";

let pickerLoad: Promise<void> | null = null;

/** Load the gapi loader once, then the Picker module. */
function loadPickerApi(): Promise<void> {
  if (pickerLoad) {
    return pickerLoad;
  }
  pickerLoad = new Promise<void>((resolve, reject) => {
    const loadPicker = () => gapi.load("picker", () => resolve());
    if (document.querySelector(`script[src="${GAPI_SRC}"]`) && typeof gapi !== "undefined") {
      loadPicker();
      return;
    }
    const script = document.createElement("script");
    script.src = GAPI_SRC;
    script.async = true;
    script.defer = true;
    script.onload = () => loadPicker();
    script.onerror = () => reject(new Error("Failed to load the Google Picker API"));
    document.head.appendChild(script);
  });
  return pickerLoad;
}

interface PickedSheet {
  id: string;
  name: string;
}

/**
 * Open the native Google Picker filtered to spreadsheets and resolve the chosen
 * sheet (or null if cancelled). Needs the user's OAuth token and a Google API
 * key (developer key) with the Picker API enabled.
 */
export async function pickSpreadsheet(
  accessToken: string,
  apiKey: string
): Promise<PickedSheet | null> {
  await loadPickerApi();
  return new Promise<PickedSheet | null>((resolve) => {
    const view = new google.picker.DocsView(google.picker.ViewId.SPREADSHEETS).setMimeTypes(
      "application/vnd.google-apps.spreadsheet"
    );
    const picker = new google.picker.PickerBuilder()
      .addView(view)
      .setOAuthToken(accessToken)
      .setDeveloperKey(apiKey)
      .setCallback((data) => {
        if (data.action === google.picker.Action.PICKED) {
          const doc = data.docs?.[0];
          resolve(doc ? { id: doc.id, name: doc.name } : null);
        } else if (data.action === google.picker.Action.CANCEL) {
          resolve(null);
        }
      })
      .build();
    picker.setVisible(true);
  });
}
