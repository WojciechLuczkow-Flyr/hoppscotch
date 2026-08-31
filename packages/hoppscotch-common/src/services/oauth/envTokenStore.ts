import {
  addEnvironmentVariable,
  getCurrentEnvironment,
  getSelectedEnvironmentIndex,
  updateEnvironmentVariable,
} from "~/newstore/environments"

/**
 * Keeps OAuth tokens in the active environment rather than in the request or
 * collection that uses them.
 *
 * Why: with short-lived access tokens (15 minutes is common) a token stored on
 * a parent collection has to be regenerated from that collection's properties
 * modal, and it silently belongs to whichever environment happened to be
 * active when it was issued. Storing it in the environment means switching
 * environments switches tokens, and any request inheriting
 * `<<access_token>>` picks up the right one with no collection writes.
 *
 * Only personal environments are writable here -- team environments live behind
 * GraphQL mutations, so callers get a Left and can say so.
 *
 * Values are stored as ordinary (non-secret) variables; see `upsert` for why.
 */

export const ACCESS_TOKEN_KEY = "access_token"
export const REFRESH_TOKEN_KEY = "refresh_token"

/** Epoch milliseconds at which the access token stops being usable. */
export const EXPIRES_AT_KEY = "access_token_expires_at"

/**
 * Refresh this far before actual expiry, so a request issued right on the
 * boundary does not race the token's death.
 */
const EXPIRY_SKEW_MS = 30_000

export type StoredTokens = {
  accessToken: string
  refreshToken: string
  expiresAt: number | null
}

export type TokenWriteError = "NO_ENVIRONMENT_SELECTED" | "TEAM_ENV_UNSUPPORTED"

const writableEnvIndex = (): number | TokenWriteError => {
  const selected = getSelectedEnvironmentIndex()

  if (selected.type === "MY_ENV") return selected.index
  if (selected.type === "TEAM_ENV") return "TEAM_ENV_UNSUPPORTED"
  return "NO_ENVIRONMENT_SELECTED"
}

/** Reads what the active environment currently holds. */
export const readStoredTokens = (): StoredTokens => {
  const variables = getCurrentEnvironment().variables ?? []

  const valueOf = (key: string) => {
    const found = variables.find((variable) => variable.key === key)
    if (!found) return ""
    // Prefer `currentValue`; a variable that was never edited may only carry
    // `initialValue`.
    return (
      (found as { currentValue?: string }).currentValue ??
      (found as { initialValue?: string }).initialValue ??
      ""
    )
  }

  const rawExpiry = valueOf(EXPIRES_AT_KEY)
  const expiresAt = rawExpiry ? Number(rawExpiry) : NaN

  return {
    accessToken: valueOf(ACCESS_TOKEN_KEY),
    refreshToken: valueOf(REFRESH_TOKEN_KEY),
    expiresAt: Number.isFinite(expiresAt) ? expiresAt : null,
  }
}

/**
 * True when there is a token and it is at (or near) expiry.
 *
 * An unknown expiry counts as NOT expired: the provider may not have sent
 * `expires_in`, and refreshing a perfectly good token on every send would be
 * worse than occasionally letting one 401.
 */
export const isAccessTokenExpired = (tokens = readStoredTokens()): boolean => {
  if (!tokens.accessToken) return false
  if (tokens.expiresAt === null) return false
  return Date.now() >= tokens.expiresAt - EXPIRY_SKEW_MS
}

/**
 * Writes a variable, adding it if absent.
 *
 * Deliberately NOT marked secret. Hoppscotch resolves `secret: true` variables
 * through SecretEnvironmentService, keyed by (environment id, variable index),
 * and ignores `currentValue` on the environment object -- so a secret written
 * here would resolve to an empty string, and `<<access_token>>` would silently
 * expand to nothing. The index-based keying is also fragile: reordering
 * variables would reassociate values.
 */
const upsert = (envIndex: number, key: string, value: string) => {
  const variables = getCurrentEnvironment().variables ?? []
  const existingIndex = variables.findIndex((variable) => variable.key === key)

  if (existingIndex === -1) {
    addEnvironmentVariable(envIndex, {
      key,
      currentValue: value,
      initialValue: value,
      secret: false,
    })
    return
  }

  updateEnvironmentVariable(envIndex, existingIndex, {
    key,
    currentValue: value,
    initialValue: value,
  })
}

/**
 * Persists a token response into the active environment.
 *
 * `expires_in` is converted to an absolute timestamp at write time -- storing
 * the relative value would make it meaningless as soon as it is read back.
 */
export const writeTokensToActiveEnvironment = (tokens: {
  access_token: string
  refresh_token?: string
  expires_in?: number
}): TokenWriteError | null => {
  const envIndex = writableEnvIndex()
  if (typeof envIndex !== "number") return envIndex

  upsert(envIndex, ACCESS_TOKEN_KEY, tokens.access_token)

  if (tokens.refresh_token) {
    upsert(envIndex, REFRESH_TOKEN_KEY, tokens.refresh_token)
  }

  // The expiry must always be rewritten, never left as-is: a timestamp from a
  // previous token would make this brand-new token look already expired.
  // Blank it out when the provider sends no `expires_in`, which readers treat
  // as "lifetime unknown".
  const hasExpiry =
    typeof tokens.expires_in === "number" && tokens.expires_in > 0

  upsert(
    envIndex,
    EXPIRES_AT_KEY,
    hasExpiry ? String(Date.now() + tokens.expires_in! * 1000) : ""
  )

  return null
}
