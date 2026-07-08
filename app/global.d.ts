import type { SessionUser } from "./user";

declare module "hono" {
  interface ContextVariableMap {
    user: SessionUser | null;
  }
}

export type Env = {
  Bindings: {
    DB: D1Database;
    SESSION_SECRET: string;
    // Optional: set to enable Google OAuth (dummy auth is used when unset).
    GOOGLE_ID?: string;
    GOOGLE_SECRET?: string;
    // Dev-only: bypass auth with a fixed Dev User.
    DEV_BYPASS_AUTH?: string;
  };
  Variables: {
    user: SessionUser | null;
  };
};
