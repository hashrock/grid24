import { clearSession, getSession, setSession } from "../utils/session";
import type { AuthProvider } from "./provider";

/**
 * Production auth: the HMAC-signed session cookie issued after Google OAuth.
 * A thin adapter over `utils/session.ts`; the cookie format and lifetime are
 * unchanged. It knows nothing about the dev bypass, so an impersonation
 * cookie that reaches production is simply not looked at.
 */
export const sessionAuth: AuthProvider = {
  resolve: (c) => getSession(c),
  signIn: (c, user) => setSession(c, user),
  signOut: async (c) => clearSession(c),
};
