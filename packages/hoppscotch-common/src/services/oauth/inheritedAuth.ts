import * as E from "fp-ts/Either"
import { HoppGQLAuth, HoppRESTAuth } from "@hoppscotch/data"
import {
  replaceTemplateString,
  replaceTemplateStringsInObjectValues,
} from "~/helpers/auth"
import authCode from "./flows/authCode"
import { OAuthTokenResponse } from "./oauth.service"
import {
  isAccessTokenExpired,
  readStoredTokens,
  writeTokensToActiveEnvironment,
} from "./envTokenStore"

/**
 * Runs the OAuth 2.0 flow for auth that a request *inherits* from a parent
 * collection, without opening that collection's properties.
 *
 * Requests commonly inherit OAuth from a collection, so refreshing a token
 * meant navigating to the parent, opening its properties modal, and generating
 * there. With a 15-minute token lifetime that is the dominant cost of using the
 * app, so the same actions are exposed on the request itself.
 *
 * Tokens land in the active environment rather than on the parent collection:
 * writing to a parent means reproducing the root-vs-folder and
 * personal-vs-team persistence rules, whereas the environment is a single
 * well-defined target that also makes tokens switch with the environment.
 */

export type InheritedOAuthError =
  | "NOT_OAUTH2"
  | "UNSUPPORTED_GRANT_TYPE"
  | "INVALID_CONFIG"
  | "NO_REFRESH_TOKEN"
  | "REFRESH_UNAVAILABLE"
  | "FLOW_FAILED"

type AnyAuth = HoppRESTAuth | HoppGQLAuth

/**
 * True when this inherited auth is something the request-level buttons can
 * actually drive. Only the authorization-code flow is offered: the other grant
 * types either need no interaction or have no refresh story worth surfacing
 * here.
 */
export const isInheritedOAuthActionable = (auth?: AnyAuth): boolean =>
  !!auth &&
  auth.authType === "oauth-2" &&
  auth.grantTypeInfo?.grantType === "AUTHORIZATION_CODE"

const authCodeParamsFrom = (auth: AnyAuth) => {
  if (auth.authType !== "oauth-2") return E.left("NOT_OAUTH2" as const)

  const info = auth.grantTypeInfo

  if (info.grantType !== "AUTHORIZATION_CODE") {
    return E.left("UNSUPPORTED_GRANT_TYPE" as const)
  }

  // The stored config holds `<<var>>` references. Resolve them against the
  // active environment before anything reaches the network layer -- notably
  // `audience`, which lives in `authRequestParams` and differs per environment.
  //
  // `replaceTemplateStringsInObjectValues` only walks TOP-LEVEL string values,
  // so the params arrays have to be resolved element by element. Missing this
  // sends the provider a literal `<<um_audience>>`.
  const resolveParams = <
    T extends { key: string; value: string; active: boolean; sendIn?: string },
  >(
    params: T[] | undefined
  ) =>
    (params ?? [])
      .filter((param) => param.active && param.key && param.value)
      .map((param) => ({
        ...param,
        key: replaceTemplateString(param.key),
        value: replaceTemplateString(param.value),
        sendIn: param.sendIn ?? "body",
      }))

  const resolved = {
    ...replaceTemplateStringsInObjectValues({
      authEndpoint: info.authEndpoint,
      tokenEndpoint: info.tokenEndpoint,
      clientID: info.clientID,
      clientSecret: info.clientSecret ?? "",
      scopes: info.scopes,
      codeVerifierMethod: info.codeVerifierMethod,
      tokenType: info.tokenType ?? "access_token",
    }),
    isPKCE: info.isPKCE,
    authRequestParams: resolveParams(info.authRequestParams),
    tokenRequestParams: resolveParams(info.tokenRequestParams),
    refreshRequestParams: resolveParams(info.refreshRequestParams),
  }

  const parsed = authCode.params.safeParse(resolved)

  return parsed.success
    ? E.right(parsed.data)
    : E.left("INVALID_CONFIG" as const)
}

const store = (tokens: OAuthTokenResponse) =>
  writeTokensToActiveEnvironment(tokens)

/**
 * Full interactive flow: opens the provider's login (in a popup) and stores the
 * resulting tokens in the active environment.
 */
export const generateTokenFromInheritedAuth = async (
  auth: AnyAuth
): Promise<E.Either<InheritedOAuthError, OAuthTokenResponse>> => {
  const params = authCodeParamsFrom(auth)
  if (E.isLeft(params)) return E.left(params.left)

  const res = await authCode.init(params.right)

  if (E.isLeft(res) || !res.right?.access_token) {
    return E.left("FLOW_FAILED")
  }

  store(res.right as OAuthTokenResponse)

  return E.right(res.right as OAuthTokenResponse)
}

/**
 * Refresh the stored token if it is about to expire, before a request goes out.
 *
 * Best-effort by design: any failure resolves quietly so the request still gets
 * sent and fails (or succeeds) on its own merits. Turning a refresh problem
 * into a blocked request would be worse than the 401 it is trying to avoid.
 *
 * Returns true only when a refresh actually happened.
 */
export const ensureFreshOAuthToken = async (
  auth?: AnyAuth
): Promise<boolean> => {
  if (!isInheritedOAuthActionable(auth)) return false

  const tokens = readStoredTokens()

  // Nothing stored, or no expiry known -- leave it alone. Refreshing on every
  // send would burn refresh tokens on providers that rotate them.
  if (!tokens.accessToken || !tokens.refreshToken) return false
  if (!isAccessTokenExpired(tokens)) return false

  const res = await refreshTokenFromInheritedAuth(auth!, tokens.refreshToken)

  return E.isRight(res)
}

/**
 * Silent refresh using a stored refresh token -- no popup, no re-login. This is
 * the path that matters for short-lived tokens.
 */
export const refreshTokenFromInheritedAuth = async (
  auth: AnyAuth,
  refreshToken: string
): Promise<E.Either<InheritedOAuthError, OAuthTokenResponse>> => {
  if (!refreshToken) return E.left("NO_REFRESH_TOKEN")

  const params = authCodeParamsFrom(auth)
  if (E.isLeft(params)) return E.left(params.left)

  const refresh = authCode.refreshToken
  if (!refresh) return E.left("REFRESH_UNAVAILABLE")

  const res = await refresh({
    tokenEndpoint: params.right.tokenEndpoint,
    clientID: params.right.clientID,
    clientSecret: params.right.clientSecret,
    refreshToken,
  })

  if (E.isLeft(res)) return E.left("FLOW_FAILED")

  store(res.right)

  return E.right(res.right)
}
