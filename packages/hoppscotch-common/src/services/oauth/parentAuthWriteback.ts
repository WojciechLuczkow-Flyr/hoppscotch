import { HoppCollection, HoppRESTAuth } from "@hoppscotch/data"
import {
  editGraphqlCollection,
  editGraphqlFolder,
  editRESTCollection,
  editRESTFolder,
  graphqlCollectionStore,
  navigateToFolderWithIndexPath,
  restCollectionStore,
} from "~/newstore/collections"
import { updateInheritedPropertiesForAffectedRequests } from "~/helpers/collection/collection"
import { getService } from "~/modules/dioc"
import { TeamCollectionsService } from "~/services/team-collection.service"
import { updateTeamCollection } from "~/helpers/backend/mutations/TeamCollection"
import { CollectionDataProps } from "~/helpers/backend/helpers"
import * as TE from "fp-ts/TaskEither"
import { pipe } from "fp-ts/function"

/**
 * Writes a freshly issued token back onto the collection (or folder) a request
 * inherits its auth from.
 *
 * Requests usually inherit OAuth from a parent, and the token is stored on that
 * parent -- so generating a token from the request pane has to update the parent
 * or nothing changes for the request that triggered it.
 *
 * `parentID` from `HoppInheritedProperty` is an index path into the personal
 * collection tree ("2" for a root collection, "2/1/0" for a nested folder),
 * which is what makes this possible without a lookup by name.
 */

export type ParentWriteError =
  "NO_PARENT" | "PARENT_NOT_FOUND" | "PARENT_NOT_OAUTH2" | "TEAM_WRITE_FAILED"

const isIndexPath = (parentID: string) =>
  parentID.length > 0 &&
  parentID.split("/").every((segment) => /^\d+$/.test(segment))

/**
 * Stores `token` (and optionally `refreshToken`) on the parent's OAuth config.
 *
 * Returns null on success, or a reason the write could not happen. Team
 * collections live behind GraphQL mutations and are not handled here.
 */
/**
 * Team collections are addressed by opaque backend id and updated through a
 * GraphQL mutation. The existing `data` blob is parsed and rewritten so that
 * headers, variables, scripts and description survive the update -- sending a
 * freshly built object would silently drop them.
 */
const writeTokenToTeamParent = async (
  parentID: string,
  token: string,
  refreshToken?: string
): Promise<ParentWriteError | null> => {
  // A nested path is "id/id/id"; the parent is the last segment.
  const collectionID = parentID.split("/").filter(Boolean).pop()
  if (!collectionID) return "NO_PARENT"

  const teamCollectionService = getService(TeamCollectionsService)
  const parent = teamCollectionService.findCollectionByID(collectionID)
  if (!parent) return "PARENT_NOT_FOUND"

  let existing: Partial<CollectionDataProps> = {}
  try {
    existing = parent.data ? JSON.parse(parent.data) : {}
  } catch {
    return "PARENT_NOT_FOUND"
  }

  const auth = existing.auth as HoppRESTAuth | undefined
  if (auth?.authType !== "oauth-2") return "PARENT_NOT_OAUTH2"

  const data = {
    ...existing,
    auth: {
      ...auth,
      grantTypeInfo: {
        ...auth.grantTypeInfo,
        token,
        ...(refreshToken &&
        auth.grantTypeInfo.grantType === "AUTHORIZATION_CODE"
          ? { refreshToken }
          : {}),
      },
    },
    headers: existing.headers ?? [],
    variables: existing.variables ?? [],
    description: existing.description ?? null,
    preRequestScript: existing.preRequestScript ?? "",
    testScript: existing.testScript ?? "",
  } as CollectionDataProps

  // Mark the collection as loading BEFORE the mutation. This is what makes the
  // refresh work: the `teamCollectionUpdated` subscription applies the new data
  // to the local tree and then removes this id, and that transition to zero is
  // what triggers the watcher that refreshes open tabs' inherited properties.
  // Without it the mutation succeeds while every open request keeps the old
  // token -- the write appears to do nothing.
  if (!teamCollectionService.loadingCollections.value.includes(collectionID)) {
    teamCollectionService.loadingCollections.value.push(collectionID)
  }

  // Set before awaiting: the subscription can land before the mutation's own
  // promise resolves, and the watcher needs this already in place.
  teamCollectionService.pendingTeamCollectionPath.value = parentID

  const result = await pipe(
    updateTeamCollection(collectionID, data, undefined),
    TE.match(
      () => "TEAM_WRITE_FAILED" as ParentWriteError,
      () => null
    )
  )()

  if (result !== null) {
    // Nothing will arrive to clear it, so undo the loading marker rather than
    // leaving the collection stuck.
    teamCollectionService.loadingCollections.value =
      teamCollectionService.loadingCollections.value.filter(
        (id) => id !== collectionID
      )
    teamCollectionService.pendingTeamCollectionPath.value = null
  }

  return result
}

export const writeTokenToParent = async (
  parentID: string | undefined,
  source: "REST" | "GraphQL",
  token: string,
  refreshToken?: string
): Promise<ParentWriteError | null> => {
  if (!parentID) return "NO_PARENT"

  // Team collection ids are opaque strings rather than index paths.
  if (!isIndexPath(parentID)) {
    return writeTokenToTeamParent(parentID, token, refreshToken)
  }

  const store = source === "REST" ? restCollectionStore : graphqlCollectionStore
  const path = parentID.split("/").map((segment) => parseInt(segment, 10))

  const parent = navigateToFolderWithIndexPath(store.value.state, [...path])
  if (!parent) return "PARENT_NOT_FOUND"

  const auth = parent.auth as HoppRESTAuth | undefined

  // Only meaningful when the parent actually holds an OAuth 2.0 config; writing
  // a token onto any other auth type would be silently discarded.
  if (auth?.authType !== "oauth-2") return "PARENT_NOT_OAUTH2"

  const grantTypeInfo = {
    ...auth.grantTypeInfo,
    token,
    ...(refreshToken && auth.grantTypeInfo.grantType === "AUTHORIZATION_CODE"
      ? { refreshToken }
      : {}),
  }

  const updated: Partial<HoppCollection> = {
    ...parent,
    auth: { ...auth, grantTypeInfo },
  } as Partial<HoppCollection>

  // A single-segment path is a root collection; anything deeper is a folder,
  // and the two have different mutators.
  const isRoot = path.length === 1

  if (source === "REST") {
    if (isRoot) editRESTCollection(path[0], updated)
    else editRESTFolder(parentID, updated)
  } else if (isRoot) {
    editGraphqlCollection(path[0], updated)
  } else {
    editGraphqlFolder(parentID, updated)
  }

  // Open tabs hold a *snapshot* of their inherited properties -- updating the
  // collection store alone leaves every open request still carrying the old
  // token, which looks exactly like the write having done nothing. This is the
  // same refresh the collection properties modal performs after saving.
  updateInheritedPropertiesForAffectedRequests(
    parentID,
    source === "REST" ? "rest" : "graphql"
  )

  return null
}
