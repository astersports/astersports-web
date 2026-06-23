export { COOKIE_NAME, ONE_YEAR_MS } from "@shared/const";

// Login sends the user to our own backend route, which redirects to Google's
// consent screen and handles the callback (server/_core/oauth.ts). Replaces the
// Manus OAuth portal. Same-origin, so the redirect_uri reflects the current host.
export const getLoginUrl = () => `${window.location.origin}/api/auth/google/login`;
