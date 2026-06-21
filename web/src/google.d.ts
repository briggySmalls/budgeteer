// Minimal ambient types for the Google Identity Services token-client API
// (loaded at runtime from https://accounts.google.com/gsi/client).
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

declare const google: {
  accounts: {
    oauth2: {
      initTokenClient(config: GisTokenClientConfig): GisTokenClient;
    };
  };
};
