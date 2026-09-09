import type { Context, MiddlewareHandler } from "hono";
import type { Env } from "../global.d";
import type { SessionUser } from "../user";

/**
 * How a request is tied to a user. The app is built against this interface
 * so that "who is signed in" can be swapped: the production session cookie,
 * the dev bypass, or a fixed user in a unit test — without any route knowing
 * which one it is talking to.
 */
export interface AuthProvider {
  /** Called once per request by the middleware. `null` = not signed in. */
  resolve(c: Context<Env>): Promise<SessionUser | null>;
  /**
   * Make subsequent requests resolve to `user`. Browsers span many requests,
   * so this has to leave state behind (a cookie), not just set a variable.
   */
  signIn(c: Context<Env>, user: SessionUser): Promise<void>;
  signOut(c: Context<Env>): Promise<void>;
}

/** The only place `c.set("user", …)` happens. */
export const authMiddleware =
  (auth: AuthProvider): MiddlewareHandler<Env> =>
  async (c, next) => {
    c.set("user", await auth.resolve(c));
    await next();
  };

/** Test double: every request is `user` (or a guest when null). */
export const fixedAuth = (user: SessionUser | null): AuthProvider => ({
  resolve: async () => user,
  signIn: async () => {},
  signOut: async () => {},
});
