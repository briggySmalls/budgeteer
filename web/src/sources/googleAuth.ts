const GIS_SRC = "https://accounts.google.com/gsi/client";
// drive.file = least privilege: the app only gets access to the sheet the user
// explicitly picks via the Picker. spreadsheets.readonly reads its values.
const SCOPES = [
  "https://www.googleapis.com/auth/spreadsheets.readonly",
  "https://www.googleapis.com/auth/drive.file",
].join(" ");

let gisPromise: Promise<void> | null = null;

/** Load the Google Identity Services script once. */
function loadGis(): Promise<void> {
  if (gisPromise) {
    return gisPromise;
  }
  gisPromise = new Promise<void>((resolve, reject) => {
    if (document.querySelector(`script[src="${GIS_SRC}"]`)) {
      resolve();
      return;
    }
    const script = document.createElement("script");
    script.src = GIS_SRC;
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Failed to load Google Identity Services"));
    document.head.appendChild(script);
  });
  return gisPromise;
}

/**
 * Run the in-browser OAuth token flow (a consent popup on first use) and resolve
 * a short-lived access token. No client secret and no backend — PKCE-style implicit
 * flow via Google Identity Services. The token is held in memory only.
 */
export async function requestAccessToken(clientId: string): Promise<string> {
  await loadGis();
  return new Promise<string>((resolve, reject) => {
    const client = google.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: SCOPES,
      callback: (response) => {
        if (response.error) {
          reject(new Error(response.error));
        } else {
          resolve(response.access_token);
        }
      },
      error_callback: (error) => reject(new Error(error.message ?? "Google sign-in failed")),
    });
    client.requestAccessToken();
  });
}
