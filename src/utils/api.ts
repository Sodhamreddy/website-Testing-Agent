// Where the audit backend lives.
//
// Empty (the default) keeps every request relative — which is what the Vite dev
// proxy and an Nginx `/api` reverse proxy both expect, i.e. frontend and backend
// on the same origin.
//
// Set VITE_API_BASE at BUILD time when the static files are hosted apart from
// the backend — e.g. `dist/` on Hostinger shared hosting while Express+Playwright
// runs on a VPS:
//
//   VITE_API_BASE=https://api.example.com npm run build
//
// The server already sends permissive CORS headers, so cross-origin works.
const BASE = (import.meta.env.VITE_API_BASE ?? '').replace(/\/+$/, '');

/** Absolute URL for a backend path such as `/api/audit/stream`. */
export function apiUrl(path: string): string {
  return BASE + path;
}
