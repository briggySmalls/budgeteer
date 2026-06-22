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

interface AccessToken {
  token: string;
  expiresIn: number;
}

/**
 * Run the in-browser OAuth token flow and resolve a short-lived access token.
 * Uses prompt: '' so the consent popup is skipped for users who have already
 * granted access. The token (with expiry) is returned to the caller, which is
 * responsible for persisting it.
 */
export async function requestAccessToken(clientId: string): Promise<AccessToken> {
  await loadGis();
  return new Promise<AccessToken>((resolve, reject) => {
    const client = google.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: SCOPES,
      prompt: "",
      callback: (response) => {
        if (response.error) {
          reject(new Error(response.error));
        } else {
          resolve({ token: response.access_token, expiresIn: Number(response.expires_in ?? 3600) });
        }
      },
      error_callback: (error) => reject(new Error(error.message ?? "Google sign-in failed")),
    });
    client.requestAccessToken();
  });
}
