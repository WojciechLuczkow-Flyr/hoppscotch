import * as E from "fp-ts/Either"

/**
 * Popup-based handling for the redirect leg of OAuth flows.
 *
 * The default behaviour navigates the whole tab to the authorization server
 * (`window.location.assign`) and relies on the app rehydrating from
 * `localStorage` once the provider redirects back. That loses in-flight UI
 * state and forces the token exchange to happen from a freshly booted app.
 *
 * Opening a popup instead keeps the main tab alive: the popup lands on
 * `/oauth`, posts the query string back to its opener, and closes. The opener
 * then performs the token exchange with its context intact.
 */

export const OAUTH_POPUP_MESSAGE = "hoppscotch/oauth-redirect"

export type OAuthPopupMessage = {
  type: typeof OAUTH_POPUP_MESSAGE
  search: string
}

const POPUP_FEATURES = "popup=yes,width=520,height=720"

/** How long to wait for the user to complete the login before giving up. */
const POPUP_TIMEOUT_MS = 5 * 60 * 1000

/** Interval for noticing that the user dismissed the popup. */
const CLOSE_POLL_MS = 500

/**
 * Opens a blank popup for the authorization request.
 *
 * MUST be called synchronously from the user gesture that starts the flow --
 * `window.open` after an `await` is treated as unsolicited and blocked. The
 * caller navigates the returned window once the authorization URL is built.
 *
 * Returns `null` when the popup was blocked, which callers should treat as a
 * signal to fall back to a full-page redirect.
 */
export const openOAuthPopup = (): Window | null =>
  window.open("about:blank", "hoppscotch_oauth", POPUP_FEATURES)

/**
 * Resolves with the query string the popup was redirected to, or a Left if the
 * user dismissed the popup or never finished logging in.
 */
export const awaitOAuthPopupRedirect = (
  popup: Window
): Promise<E.Either<"POPUP_CLOSED" | "POPUP_TIMED_OUT", URLSearchParams>> =>
  new Promise((resolve) => {
    const disposers: Array<() => void> = []

    let settled = false

    const finish = (
      result: E.Either<"POPUP_CLOSED" | "POPUP_TIMED_OUT", URLSearchParams>
    ) => {
      if (settled) return
      settled = true
      disposers.forEach((dispose) => dispose())
      resolve(result)
    }

    const onMessage = (event: MessageEvent) => {
      // Only trust messages from our own origin -- the popup sits on the
      // provider's origin while the user logs in, and anything arriving from
      // there is untrusted.
      if (event.origin !== window.location.origin) return
      if (event.source !== popup) return

      const data = event.data as OAuthPopupMessage | undefined
      if (data?.type !== OAUTH_POPUP_MESSAGE) return

      finish(E.right(new URLSearchParams(data.search)))
    }

    window.addEventListener("message", onMessage)
    disposers.push(() => window.removeEventListener("message", onMessage))

    // `closed` is readable even while the popup sits on a cross-origin page,
    // so this catches the user dismissing the login window.
    const closePoll = setInterval(() => {
      if (popup.closed) finish(E.left("POPUP_CLOSED"))
    }, CLOSE_POLL_MS)
    disposers.push(() => clearInterval(closePoll))

    const timeout = setTimeout(
      () => finish(E.left("POPUP_TIMED_OUT")),
      POPUP_TIMEOUT_MS
    )
    disposers.push(() => clearTimeout(timeout))
  })

/**
 * True when the current document is the popup opened by `openOAuthPopup`,
 * rather than the tab the user works in.
 */
export const isOAuthPopup = (): boolean => {
  try {
    return Boolean(window.opener) && window.opener !== window
  } catch {
    // Touching `opener` can throw in some sandboxed contexts.
    return false
  }
}

/**
 * Called from the `/oauth` route when running inside the popup: hands the
 * redirect query string to the opener and closes.
 */
export const postRedirectToOpener = (): boolean => {
  if (!isOAuthPopup()) return false

  const message: OAuthPopupMessage = {
    type: OAUTH_POPUP_MESSAGE,
    search: window.location.search,
  }

  window.opener.postMessage(message, window.location.origin)
  window.close()

  return true
}
