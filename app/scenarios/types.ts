import type { NewIcon } from "../db/icons";

/**
 * What a scenario builder gets to work with. Everything random or clock-bound
 * is passed in, so building a plan is a pure function and unit-testable.
 */
export type BuildContext = {
  /** Owner of every icon the scenario creates. */
  userId: string;
  /** `scenario-<name>-<random>`; prefixes every created name for isolation. */
  tag: string;
  /** ISO timestamp used as "now". */
  now: string;
};

export type ScenarioPlan = {
  icons: NewIcon[];
  /** Where the browser is sent once the data exists. */
  redirectTo: string;
};

export type Scenario = {
  name: string;
  description: string;
  /**
   * `fresh-user`: only meaningful on an account with no other data, so it
   * needs a throwaway user — available only when DEV_BYPASS_AUTH is on.
   * `user`: works on any signed-in account; adds isolated icons to it.
   */
  needs: "fresh-user" | "user";
  /**
   * The target page is meant to be seen logged out (e.g. a public icon page
   * as a visitor). Honoured only under DEV_BYPASS_AUTH, where guest mode is a
   * cookie away; otherwise the signed-in user sees it as the owner.
   */
  viewAsGuest?: boolean;
  build(ctx: BuildContext): ScenarioPlan;
};
