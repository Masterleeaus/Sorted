import {
  beginLogin,
  buildTokenExchangeBody,
  CentralClientError,
  createJwksClient,
  fetchDiscovery,
  openPendingLogin,
  parseCentralOidcConfig,
  verifyIdToken,
  type CentralOidcConfig,
  type PendingLogin,
} from "@ai-fsm/central-client";
import type { Role } from "@ai-fsm/domain";

/**
 * Sorted sign-in through Titan Central (OIDC Authorization Code + PKCE).
 *
 * Framework-free core. The routes under app/api/central/ own cookies and
 * sessions; this module returns plain results. Nothing here touches the
 * existing Logto login flow in app/api/v1/auth/login.
 *
 * Off unless TITAN_SORTED_CENTRAL_ENABLED is exactly "true".
 */

export const CENTRAL_SIGN_IN_FLAG = "TITAN_SORTED_CENTRAL_ENABLED";
export const CENTRAL_LOGIN_COOKIE = "fsm_central_login";
export const CENTRAL_CALLBACK_PATH = "/api/central/callback";
export const CENTRAL_LOGIN_COOKIE_MAX_AGE_SECONDS = 10 * 60;

type EnvLike = Readonly<Record<string, string | undefined>>;
export type CentralFetch = (input: string, init?: RequestInit) => Promise<Response>;

export interface LinkedLocalUser {
  userId: string;
  accountId: string;
  role: Role;
}

export interface CentralSignInDeps {
  env?: EnvLike;
  fetcher?: CentralFetch;
  now?: () => number;
  /**
   * Maps a verified Central subject to a local user. Fails closed: the default
   * returns null, because the repo has no Central-to-local account link store yet.
   */
  resolveLocalUser?: (subject: { sub: string; iss: string }) => Promise<LinkedLocalUser | null>;
}

export type SignInResult =
  | { kind: "disabled" }
  | { kind: "unavailable" }
  | { kind: "redirect"; location: string; pendingCookie: string };

export type CallbackResult =
  | { kind: "disabled" }
  | { kind: "failed"; clearPendingCookie: true }
  | { kind: "signed_in"; user: LinkedLocalUser; clearPendingCookie: true };

export const noLinkedLocalUser = async (): Promise<LinkedLocalUser | null> => null;

export function isCentralSignInEnabled(env: EnvLike = process.env): boolean {
  return env[CENTRAL_SIGN_IN_FLAG] === "true";
}

export function encodePendingCookie(pending: PendingLogin): string {
  return Buffer.from(JSON.stringify(pending), "utf8").toString("base64url");
}

export function decodePendingCookie(value: string | undefined): PendingLogin | null {
  if (!value) return null;
  try {
    const parsed: unknown = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
    if (typeof parsed !== "object" || parsed === null) return null;
    const p = parsed as Record<string, unknown>;
    if (
      typeof p.stateDigest !== "string" ||
      typeof p.sealedCodeVerifier !== "string" ||
      typeof p.sealedNonce !== "string" ||
      typeof p.expiresAt !== "number"
    ) {
      return null;
    }
    return { stateDigest: p.stateDigest, sealedCodeVerifier: p.sealedCodeVerifier, sealedNonce: p.sealedNonce, expiresAt: p.expiresAt };
  } catch {
    return null;
  }
}

function loadConfig(env: EnvLike): CentralOidcConfig | null {
  try {
    return parseCentralOidcConfig(env);
  } catch (error) {
    if (error instanceof CentralClientError) return null;
    throw error;
  }
}

export async function startCentralSignIn(deps: CentralSignInDeps = {}): Promise<SignInResult> {
  const env = deps.env ?? process.env;
  if (!isCentralSignInEnabled(env)) return { kind: "disabled" };

  const config = loadConfig(env);
  if (!config) return { kind: "unavailable" };

  const fetcher = deps.fetcher ?? (fetch as CentralFetch);
  try {
    const discovery = await fetchDiscovery(config, fetcher as never);
    const began = beginLogin({ config, discovery, now: deps.now?.() ?? Date.now() });
    return {
      kind: "redirect",
      location: began.authorizationUrl,
      pendingCookie: encodePendingCookie(began.pending),
    };
  } catch (error) {
    if (error instanceof CentralClientError) return { kind: "unavailable" };
    throw error;
  }
}

export async function finishCentralSignIn(
  input: { code: string | null; state: string | null; error: string | null; pendingCookie: string | undefined },
  deps: CentralSignInDeps = {},
): Promise<CallbackResult> {
  const env = deps.env ?? process.env;
  if (!isCentralSignInEnabled(env)) return { kind: "disabled" };

  const failed: CallbackResult = { kind: "failed", clearPendingCookie: true };
  const pending = decodePendingCookie(input.pendingCookie);
  const config = loadConfig(env);
  if (input.error || !input.code || !input.state || !pending || !config) return failed;

  const now = deps.now ?? Date.now;
  const fetcher = deps.fetcher ?? (fetch as CentralFetch);
  const resolveLocalUser = deps.resolveLocalUser ?? noLinkedLocalUser;

  try {
    const discovery = await fetchDiscovery(config, fetcher as never);
    const opened = openPendingLogin({ config, pending, returnedState: input.state, now: now() });
    const body = buildTokenExchangeBody(config, input.code, opened.codeVerifier);

    const tokenResponse = await fetcher(discovery.tokenEndpoint, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
      body: body.toString(),
      redirect: "error",
    });
    if (!tokenResponse.ok) return failed;
    const tokenJson = (await tokenResponse.json()) as { id_token?: unknown };
    if (typeof tokenJson.id_token !== "string") return failed;

    const keys = createJwksClient({ jwksUri: config.jwksUri, fetcher: fetcher as never, clock: now });
    const claims = await verifyIdToken({
      token: tokenJson.id_token,
      config,
      expectedNonce: opened.nonce,
      keys,
      now: now(),
    });

    const user = await resolveLocalUser({ sub: claims.sub, iss: claims.iss });
    if (!user) return failed;
    return { kind: "signed_in", user, clearPendingCookie: true };
  } catch (error) {
    if (error instanceof CentralClientError) return failed;
    throw error;
  }
}
