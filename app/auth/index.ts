import { drizzle } from "drizzle-orm/d1";
import { ensureUser } from "../db/icons";
import type { SessionUser } from "../user";
import { createBypassAuth } from "./bypassAuth";
import type { AuthProvider } from "./provider";
import { sessionAuth } from "./sessionAuth";

export type { AuthProvider } from "./provider";
export { authMiddleware, fixedAuth } from "./provider";
export { sessionAuth } from "./sessionAuth";
export { createBypassAuth, GUEST_COOKIE, IMPERSONATE_COOKIE } from "./bypassAuth";

/** The account the dev bypass signs in as; auto-provisioned in the DB. */
export const DEV_USER: SessionUser = {
  id: "dev-user",
  email: "dev@localhost",
  name: "Dev User",
  avatarUrl: "",
};

const bypassAuth = createBypassAuth({
  devUser: DEV_USER,
  provisionDevUser: (c) => ensureUser(drizzle(c.env.DB), DEV_USER),
});

/**
 * The provider the deployed app uses. Workers only see `env` per request, so
 * the choice between bypass and session auth is made here, once, on every
 * call — nothing else in the app inspects `DEV_BYPASS_AUTH` to decide who a
 * request belongs to.
 */
export const envAuth: AuthProvider = {
  resolve: (c) => (c.env.DEV_BYPASS_AUTH ? bypassAuth : sessionAuth).resolve(c),
  signIn: (c, user) => (c.env.DEV_BYPASS_AUTH ? bypassAuth : sessionAuth).signIn(c, user),
  signOut: (c) => (c.env.DEV_BYPASS_AUTH ? bypassAuth : sessionAuth).signOut(c),
};
