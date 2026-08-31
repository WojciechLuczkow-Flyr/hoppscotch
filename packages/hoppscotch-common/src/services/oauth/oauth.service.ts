import { pipe } from "fp-ts/function"
import * as O from "fp-ts/Option"
import * as E from "fp-ts/Either"
import { Service } from "dioc"
import { PersistenceService } from "../persistence"
import { ZodType, z } from "zod"
import authCode, { AuthCodeOauthFlowParams } from "./flows/authCode"
import implicit, { ImplicitOauthFlowParams } from "./flows/implicit"
import { getService } from "~/modules/dioc"
import { HoppCollection } from "@hoppscotch/data"
import { TeamCollection } from "~/helpers/backend/graphql"
import { parseBytesToJSON } from "~/helpers/functional/json"
import { MediaType } from "@hoppscotch/kernel"

const persistenceService = getService(PersistenceService)

export type PersistedOAuthConfig = {
  source: "REST" | "GraphQL"
  context?: {
    type: "collection-properties" | "request-tab"
    metadata: {
      collection?: HoppCollection | TeamCollection
      collectionID?: string
    }
  }
  grant_type: string
  fields?: (AuthCodeOauthFlowParams | ImplicitOauthFlowParams) & {
    state: string
  }
  token?: string
  refresh_token?: string
}

export const grantTypesInvolvingRedirect = ["AUTHORIZATION_CODE", "IMPLICIT"]

/**
 * What a token or refresh exchange yields.
 *
 * `expires_in` is the provider's lifetime in seconds when it sends one; callers
 * convert it to an absolute timestamp before storing.
 */
export type OAuthTokenResponse = {
  access_token: string
  refresh_token?: string
  expires_in?: number
}

export const routeOAuthRedirect = async () => {
  // get the temp data from the local storage
  const localOAuthTempConfig =
    await persistenceService.getLocalConfig("oauth_temp_config")

  if (!localOAuthTempConfig) {
    return E.left("INVALID_STATE")
  }

  const expectedSchema = z.object({
    source: z.optional(z.string()),
    grant_type: z.string(),
  })

  const decodedLocalConfig = expectedSchema.safeParse(
    JSON.parse(localOAuthTempConfig)
  )

  if (!decodedLocalConfig.success) {
    return E.left("INVALID_STATE")
  }

  // route the request to the correct flow
  const flowConfig = [authCode, implicit].find(
    (flow) => flow.flow === decodedLocalConfig.data.grant_type
  )

  if (!flowConfig) {
    return E.left("INVALID_STATE")
  }

  return flowConfig?.onRedirectReceived(localOAuthTempConfig)
}

export function createFlowConfig<
  Flow extends string,
  AuthParams extends Record<string, unknown>,
  InitFuncReturnObject extends Record<string, unknown>,
  RefreshTokenParams extends Record<string, unknown>,
>(
  flow: Flow,
  params: ZodType<AuthParams>,
  // Redirect-based flows resolve with `undefined` because the token only
  // arrives after the provider redirects back. The popup variant completes the
  // exchange inline, so it resolves with the token instead.
  init: (
    params: AuthParams
  ) =>
    | E.Either<string, InitFuncReturnObject | undefined>
    | Promise<E.Either<string, InitFuncReturnObject | undefined>>,
  onRedirectReceived: (localConfig: string) => Promise<
    E.Either<string, OAuthTokenResponse>
  >,
  refreshToken?: (
    params: RefreshTokenParams
  ) => Promise<E.Either<string, OAuthTokenResponse>>
) {
  return {
    flow,
    params,
    init,
    onRedirectReceived,
    refreshToken,
  }
}

export const decodeResponseAsJSON = (response: {
  body: { body: Uint8Array; mediaType: MediaType }
}): E.Either<"AUTH_TOKEN_REQUEST_FAILED", Record<string, unknown>> =>
  pipe(
    response.body.body,
    parseBytesToJSON<Record<string, unknown>>,
    O.fold(
      () => E.left("AUTH_TOKEN_REQUEST_FAILED" as const),
      (data) => E.right(data)
    )
  )

export class OauthAuthService extends Service {
  public static readonly ID = "OAUTH_AUTH_SERVICE"

  /**
   * Where the authorization server sends the user back to.
   *
   * Defaults to `<origin>/oauth`, but can be pointed at any path the identity
   * provider already has registered -- some IdPs are administered by a
   * different team, and getting a new callback URL allow-listed is slower than
   * matching one that exists. The router forwards OAuth params arriving on any
   * path to `/oauth`, so the handling code stays in one place.
   */
  static redirectURI =
    import.meta.env.VITE_OAUTH_REDIRECT_URI || `${window.location.origin}/oauth`
}

export const generateRandomString = () => {
  const length = 64
  const possible =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789"
  const values = crypto.getRandomValues(new Uint8Array(length))
  return values.reduce((acc, x) => acc + possible[x % possible.length], "")
}
