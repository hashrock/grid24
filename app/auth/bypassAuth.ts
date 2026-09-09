import type { Context } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import type { Env } from "../global.d";
import type { SessionUser } from "../user";
import { sign, verify } from "../utils/session";
import type { AuthProvider } from "./provider";

/**
 * Dev auth, selected only while `DEV_BYPASS_AUTH` is set. No OAuth round-trip:
 * requests resolve to a fixed Dev User unless one of two dev toggles says
 * otherwise, both of which live here and nowhere else:
 *
 * - guest mode (`?guest=1`, persisted in `dev_guest`) previews the logged-out
 *   experience;
 * - impersonation (`dev_impersonate`, a signed cookie written by `signIn`)
 *   makes requests resolve to some other user, e.g. the throwaway account a
 *   UI-test scenario just created.
 *
 * The impersonation cookie is signed so a stray or hand-edited value falls
 * back to the Dev User instead of minting an arbitrary identity.
 */

export const GUEST_COOKIE = "dev_guest";
export const IMPERSONATE_COOKIE = "dev_impersonate";

/** Signing key: the session secret when configured, else a dev-only constant. */
const secretOf = (c: Context<Env>) => c.env.SESSION_SECRET || "dev-bypass-auth";

export type BypassAuthOptions = {
  /** Who requests resolve to by default. */
  devUser: SessionUser;
  /**
   * Called whenever the Dev User is resolved, so the app can make sure the
   * account exists in storage (it is not created by any sign-up flow).
   */
  provisionDevUser?: (c: Context<Env>) => Promise<void>;
};

const cookieOpts = { path: "/", sameSite: "Lax" as const };

const setGuest = (c: Context<Env>, guest: boolean) =>
  guest
    ? setCookie(c, GUEST_COOKIE, "1", cookieOpts)
    : deleteCookie(c, GUEST_COOKIE, { path: "/" });

async function impersonated(c: Context<Env>): Promise<SessionUser | null> {
  const token = getCookie(c, IMPERSONATE_COOKIE);
  if (!token) return null;
  try {
    const payload = await verify(token, secretOf(c));
    if (!payload) return null;
    const user = JSON.parse(atob(payload)) as SessionUser;
    return typeof user?.id === "string" ? user : null;
  } catch {
    return null;
  }
}

export function createBypassAuth({ devUser, provisionDevUser }: BypassAuthOptions): AuthProvider {
  return {
    async resolve(c) {
      let guest = getCookie(c, GUEST_COOKIE) === "1";
      const q = new URL(c.req.url).searchParams.get("guest");
      if (q !== null) {
        guest = q !== "0";
        setGuest(c, guest);
      }
      if (guest) return null;

      const other = await impersonated(c);
      if (other) return other;

      await provisionDevUser?.(c);
      return devUser;
    },

    async signIn(c, user) {
      setGuest(c, false);
      if (user.id === devUser.id) {
        // The default identity needs no cookie; dropping any impersonation
        // also sends the request back through provisioning.
        deleteCookie(c, IMPERSONATE_COOKIE, { path: "/" });
        return;
      }
      const token = await sign(btoa(JSON.stringify(user)), secretOf(c));
      setCookie(c, IMPERSONATE_COOKIE, token, cookieOpts);
    },

    async signOut(c) {
      deleteCookie(c, IMPERSONATE_COOKIE, { path: "/" });
      // The bypass would sign us straight back in; show the guest view instead.
      setGuest(c, true);
    },
  };
}
