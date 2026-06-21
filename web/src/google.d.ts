// Minimal ambient types for the Google browser libraries loaded at runtime:
// Google Identity Services (https://accounts.google.com/gsi/client) and the
// Picker API (via https://apis.google.com/js/api.js).
interface GisTokenResponse {
  access_token: string;
  error?: string;
}

interface GisTokenClient {
  requestAccessToken(): void;
}

interface GisTokenClientConfig {
  client_id: string;
  scope: string;
  callback: (response: GisTokenResponse) => void;
  error_callback?: (error: { type?: string; message?: string }) => void;
}

interface GooglePickerDocument {
  id: string;
  name: string;
}

interface GooglePickerResponse {
  action: string;
  docs?: GooglePickerDocument[];
}

declare namespace google {
  namespace accounts.oauth2 {
    function initTokenClient(config: GisTokenClientConfig): GisTokenClient;
  }

  namespace picker {
    enum Action {
      PICKED = "picked",
      CANCEL = "cancel",
    }
    enum ViewId {
      SPREADSHEETS = "spreadsheets",
    }
    class DocsView {
      constructor(viewId?: ViewId);
      setMimeTypes(mimeTypes: string): DocsView;
    }
    class PickerBuilder {
      addView(view: DocsView): PickerBuilder;
      setOAuthToken(token: string): PickerBuilder;
      setDeveloperKey(key: string): PickerBuilder;
      setCallback(callback: (data: GooglePickerResponse) => void): PickerBuilder;
      build(): { setVisible(visible: boolean): void };
    }
  }
}

declare const gapi: {
  load(api: string, callback: () => void): void;
};
