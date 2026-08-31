<template>
  <div class="flex flex-1 flex-col">
    <div
      class="sticky z-10 flex flex-shrink-0 items-center justify-between overflow-x-auto border-b border-dividerLight bg-primary pl-4"
      :class="[
        isCollectionProperty
          ? 'top-propertiesPrimaryStickyFold'
          : 'top-upperMobileSecondaryStickyFold sm:top-upperSecondaryStickyFold',
      ]"
    >
      <span class="flex items-center">
        <label class="truncate font-semibold text-secondaryLight">
          {{ t("authorization.type") }}
        </label>
        <tippy
          interactive
          trigger="click"
          theme="popover"
          :on-shown="() => tippyActions.focus()"
        >
          <HoppSmartSelectWrapper>
            <HoppButtonSecondary
              class="ml-2 rounded-none pr-8"
              :label="authName"
            />
          </HoppSmartSelectWrapper>
          <template #content="{ hide }">
            <div
              ref="tippyActions"
              class="flex flex-col focus:outline-none"
              tabindex="0"
              @keyup.escape="hide()"
            >
              <HoppSmartItem
                v-for="item in authTypes"
                :key="item.key"
                :label="item.label"
                :icon="item.key === authType ? IconCircleDot : IconCircle"
                :active="item.key === authType"
                @click="
                  () => {
                    item.handler
                      ? item.handler()
                      : (auth = { ...auth, authType: item.key } as HoppRESTAuth)
                    hide()
                  }
                "
              />
            </div>
          </template>
        </tippy>
      </span>
      <div class="flex">
        <!-- <HoppSmartCheckbox
          :on="!URLExcludes.auth"
          @change="setExclude('auth', !$event)"
        >
          {{ $t("authorization.include_in_url") }}
        </HoppSmartCheckbox>-->
        <HoppSmartCheckbox
          :on="authActive"
          class="px-2"
          @change="authActive = !authActive"
        >
          {{ t("state.enabled") }}
        </HoppSmartCheckbox>
        <HoppButtonSecondary
          v-tippy="{ theme: 'tooltip' }"
          to="https://docs.hoppscotch.io/documentation/features/authorization"
          blank
          :title="t('app.wiki')"
          :icon="IconHelpCircle"
        />
        <HoppButtonSecondary
          v-tippy="{ theme: 'tooltip' }"
          :title="t('action.clear')"
          :icon="IconTrash2"
          @click="clearContent"
        />
      </div>
    </div>
    <HoppSmartPlaceholder
      v-if="auth.authType === 'none'"
      :src="`/images/states/${colorMode.value}/login.svg`"
      :alt="`${t('empty.authorization')}`"
      :text="t('empty.authorization')"
    >
      <template #body>
        <HoppButtonSecondary
          outline
          :label="t('app.documentation')"
          to="https://docs.hoppscotch.io/documentation/features/authorization"
          blank
          :icon="IconExternalLink"
          reverse
        />
      </template>
    </HoppSmartPlaceholder>
    <div v-else class="flex flex-1 border-b border-dividerLight">
      <div class="w-2/3 border-r border-dividerLight">
        <div v-if="auth.authType === 'basic'">
          <HttpAuthorizationBasic v-model="auth" :envs="envs" />
        </div>
        <div v-if="auth.authType === 'inherit'" class="p-4">
          <span v-if="inheritedProperties?.auth">
            {{
              t("authorization.inherited_from", {
                auth: getAuthName(
                  inheritedProperties.auth.inheritedAuth.authType
                ),
                collection: inheritedProperties?.auth.parentName,
              })
            }}
          </span>
          <span v-else>
            {{ t("authorization.save_to_inherit") }}
          </span>

          <!--
            Token actions for inherited OAuth 2.0. Without these, refreshing a
            short-lived token means leaving the request, finding the parent
            collection and opening its properties modal.
          -->
          <div
            v-if="canActOnInheritedOAuth"
            class="flex items-center gap-2 mt-4"
          >
            <HoppButtonSecondary
              :label="t('authorization.oauth.generate_token')"
              :loading="isGeneratingInheritedToken"
              filled
              outline
              @click="generateInheritedToken"
            />
            <HoppButtonSecondary
              :label="t('authorization.oauth.refresh_token')"
              :loading="isRefreshingInheritedToken"
              outline
              @click="refreshInheritedToken"
            />
            <span class="text-tiny text-secondaryLight">
              {{ inheritedTokenStatus }}
            </span>
          </div>
        </div>
        <div v-if="auth.authType === 'bearer'">
          <div class="flex flex-1 border-b border-dividerLight">
            <label
              class="flex items-center ml-4 text-secondaryLight min-w-[6rem]"
            >
              {{ t("authorization.token") }}
            </label>
            <SmartEnvInput
              v-model="auth.token"
              placeholder="Your Bearer Token (e.g. sk_live_abc123xyz789)"
              :auto-complete-env="true"
              :envs="envs"
              class="px-4"
            />
          </div>
        </div>
        <div v-if="auth.authType === 'oauth-2'" class="w-full">
          <div class="flex flex-1 border-b border-dividerLight">
            <label
              class="flex items-center ml-4 text-secondaryLight min-w-[6rem]"
            >
              {{ t("authorization.token") }}
            </label>
            <!-- Ensure a new object is assigned here to avoid reactivity issues -->
            <SmartEnvInput
              :model-value="auth.grantTypeInfo.token"
              placeholder="Your OAuth 2.0 Token (e.g. sk_live_abc123xyz789)"
              :envs="envs"
              @update:model-value="
                auth.grantTypeInfo = { ...auth.grantTypeInfo, token: $event }
              "
            />
          </div>
          <HttpAuthorizationOAuth2
            v-model="auth"
            :is-collection-property="isCollectionProperty"
            :envs="envs"
            :source="source"
          />
        </div>
        <div v-if="auth.authType === 'api-key'">
          <HttpAuthorizationApiKey v-model="auth" :envs="envs" />
        </div>
        <div v-if="auth.authType === 'aws-signature'">
          <HttpAuthorizationAWSSign v-model="auth" :envs="envs" />
        </div>
        <div v-if="auth.authType === 'hawk'">
          <HttpAuthorizationHAWK v-model="auth" :envs="envs" />
        </div>
        <div v-if="auth.authType === 'digest'">
          <HttpAuthorizationDigest v-model="auth" :envs="envs" />
        </div>
        <div v-if="auth.authType === 'jwt'">
          <HttpAuthorizationJWT
            v-model="auth"
            :envs="envs"
            :scoped-envs="scopedEnvs"
          />
        </div>
      </div>
      <div
        class="z-[9] sticky top-upperTertiaryStickyFold h-full min-w-[12rem] max-w-1/3 flex-shrink-0 overflow-auto overflow-x-auto bg-primary p-4"
      >
        <div class="pb-2 text-secondaryLight">
          {{ t("helpers.authorization") }}
        </div>
        <HoppSmartAnchor
          class="link"
          :label="t('authorization.learn')"
          :icon="IconExternalLink"
          to="https://docs.hoppscotch.io/documentation/features/authorization"
          blank
          reverse
        />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useI18n } from "@composables/i18n"
import { pluckRef } from "@composables/ref"
import { useColorMode } from "@composables/theming"
import { useVModel } from "@vueuse/core"
import { computed, onMounted, ref } from "vue"
import { HoppInheritedProperty } from "~/helpers/types/HoppInheritedProperties"
import { AggregateEnvironment, environments$ } from "~/newstore/environments"
import { useReadonlyStream } from "@composables/stream"
import IconCircle from "~icons/lucide/circle"
import IconCircleDot from "~icons/lucide/circle-dot"
import IconExternalLink from "~icons/lucide/external-link"
import IconHelpCircle from "~icons/lucide/help-circle"
import IconTrash2 from "~icons/lucide/trash-2"

import { getDefaultAuthCodeOauthFlowParams } from "~/services/oauth/flows/authCode"
import { writeTokenToParent } from "~/services/oauth/parentAuthWriteback"
import {
  generateTokenFromInheritedAuth,
  isInheritedOAuthActionable,
  refreshTokenFromInheritedAuth,
} from "~/services/oauth/inheritedAuth"
import {
  isAccessTokenExpired,
  readStoredTokens,
} from "~/services/oauth/envTokenStore"
import { useToast } from "@composables/toast"
import * as E from "fp-ts/Either"
import {
  HoppRESTAuth,
  HoppRESTAuthAWSSignature,
  HoppRESTAuthDigest,
  HoppRESTAuthHAWK,
  HoppRESTAuthOAuth2,
  HoppRESTAuthJWT,
} from "@hoppscotch/data"

const t = useI18n()
const toast = useToast()

const colorMode = useColorMode()

const props = withDefaults(
  defineProps<{
    modelValue: HoppRESTAuth
    isCollectionProperty?: boolean
    isRootCollection?: boolean
    inheritedProperties?: HoppInheritedProperty
    envs?: AggregateEnvironment[]
    scopedEnvs?: AggregateEnvironment[]
    source?: "REST" | "GraphQL"
  }>(),
  {
    source: "REST",
    envs: undefined,
    scopedEnvs: undefined,
    inheritedProperties: undefined,
  }
)

const emit = defineEmits<{
  (e: "update:modelValue", value: HoppRESTAuth): void
}>()

const auth = useVModel(props, "modelValue", emit)

/* --- Token actions for auth inherited from a parent collection ------------ */

const isGeneratingInheritedToken = ref(false)

const isRefreshingInheritedToken = ref(false)

/** Only offered for inherited authorization-code OAuth 2.0. */
const canActOnInheritedOAuth = computed(
  () =>
    auth.value.authType === "inherit" &&
    isInheritedOAuthActionable(props.inheritedProperties?.auth.inheritedAuth)
)

/**
 * Short status next to the buttons, so the state of a token stored in the
 * environment is visible without opening the environment editor.
 */
/**
 * `environmentsStore.value` is an rxjs BehaviorSubject read, not a Vue ref, so
 * a computed touching it would never re-evaluate. Subscribing here gives the
 * status below something reactive to depend on.
 */
const environmentsSnapshot = useReadonlyStream(environments$, [])

const inheritedTokenStatus = computed(() => {
  // Referenced purely to register the dependency; the values come from the
  // store helpers, which read the same source.
  void environmentsSnapshot.value

  const tokens = readStoredTokens()

  if (!tokens.accessToken) return t("authorization.oauth.no_stored_token")
  if (isAccessTokenExpired(tokens))
    return t("authorization.oauth.token_expired")

  if (tokens.expiresAt === null) return t("authorization.oauth.token_stored")

  const minutes = Math.max(
    0,
    Math.round((tokens.expiresAt - Date.now()) / 60_000)
  )
  return t("authorization.oauth.token_valid_for", { minutes })
})

/**
 * Push the token onto the parent collection so the request that triggered this
 * actually uses it. Storing it only in the environment would require the parent
 * to reference `<<access_token>>`, which is easy to forget.
 */
const applyTokenToParent = async (tokens: {
  access_token: string
  refresh_token?: string
}) => {
  const failure = await writeTokenToParent(
    props.inheritedProperties?.auth.parentID,
    props.source,
    tokens.access_token,
    tokens.refresh_token
  )

  // Every failure is surfaced: a silently skipped write looks identical to a
  // broken token, which is impossible to diagnose from the UI.
  const messages: Record<string, string> = {
    TEAM_WRITE_FAILED: "authorization.oauth.parent_team_write_failed",
    NO_PARENT: "authorization.oauth.parent_write_no_parent",
    PARENT_NOT_FOUND: "authorization.oauth.parent_write_not_found",
    PARENT_NOT_OAUTH2: "authorization.oauth.parent_write_not_oauth2",
  }

  if (failure) {
    toast.show(`${t(messages[failure])}`)
    // Also log the parent identifier: it distinguishes a team path (opaque ids)
    // from a personal index path at a glance.
    console.warn(
      "[oauth] parent token write skipped:",
      failure,
      "parentID:",
      props.inheritedProperties?.auth.parentID
    )
  }
}

const inheritedAuthErrorMessage = (error: string) => {
  switch (error) {
    case "NO_REFRESH_TOKEN":
      return t("authorization.oauth.no_refresh_token_present")
    case "INVALID_CONFIG":
      return t("authorization.oauth.something_went_wrong_on_token_generation")
    default:
      return t("authorization.oauth.something_went_wrong_on_token_generation")
  }
}

const generateInheritedToken = async () => {
  const inherited = props.inheritedProperties?.auth.inheritedAuth
  if (!inherited) return

  isGeneratingInheritedToken.value = true
  try {
    const res = await generateTokenFromInheritedAuth(inherited)
    if (E.isLeft(res)) {
      toast.error(`${inheritedAuthErrorMessage(res.left)}`)
      return
    }
    await applyTokenToParent(res.right)
    toast.success(`${t("authorization.oauth.token_fetched_successfully")}`)
  } finally {
    isGeneratingInheritedToken.value = false
  }
}

const refreshInheritedToken = async () => {
  const inherited = props.inheritedProperties?.auth.inheritedAuth
  if (!inherited) return

  isRefreshingInheritedToken.value = true
  try {
    // Prefer the refresh token held in the environment; fall back to one saved
    // on the parent collection for setups that predate environment storage.
    const stored = readStoredTokens().refreshToken
    const fromParent =
      inherited.authType === "oauth-2" &&
      "refreshToken" in inherited.grantTypeInfo
        ? (inherited.grantTypeInfo.refreshToken ?? "")
        : ""

    const res = await refreshTokenFromInheritedAuth(
      inherited,
      stored || fromParent
    )

    if (E.isLeft(res)) {
      toast.error(`${inheritedAuthErrorMessage(res.left)}`)
      return
    }
    await applyTokenToParent(res.right)
    toast.success(`${t("authorization.oauth.token_fetched_successfully")}`)
  } finally {
    isRefreshingInheritedToken.value = false
  }
}

onMounted(() => {
  if (props.isRootCollection && auth.value.authType === "inherit") {
    auth.value = {
      authType: "none",
      authActive: true,
    }
  }
})

type AuthType = {
  key: HoppRESTAuth["authType"]
  label: string
  handler?: () => void
}

const selectAPIKeyAuthType = () => {
  auth.value = {
    ...auth.value,
    authType: "api-key",
    addTo: "HEADERS",
  } as HoppRESTAuth
}

const selectAWSSignatureAuthType = () => {
  const {
    accessKey = "",
    secretKey = "",
    region = "",
    serviceName = "",
    addTo = "HEADERS",
  } = auth.value as HoppRESTAuthAWSSignature

  auth.value = {
    ...auth.value,
    authType: "aws-signature",
    addTo,
    accessKey,
    secretKey,
    region,
    serviceName,
  }
}

const selectHAWKAuthType = () => {
  const { algorithm = "sha256" } = auth.value as HoppRESTAuthHAWK
  auth.value = {
    ...auth.value,
    authType: "hawk",
    algorithm,
  } as HoppRESTAuth
}

const selectDigestAuthType = () => {
  const {
    username = "",
    password = "",
    algorithm = "MD5",
  } = auth.value as HoppRESTAuthDigest

  auth.value = {
    ...auth.value,
    authType: "digest",
    username,
    password,
    algorithm,
  } as HoppRESTAuth
}

const selectJWTAuthType = () => {
  auth.value = {
    ...auth.value,
    authType: "jwt",
    secret: "",
    algorithm: "HS256",
    payload: "{}",
    addTo: "HEADERS",
    isSecretBase64Encoded: false,
    headerPrefix: "Bearer ",
    paramName: "token",
    jwtHeaders: "{}",
  } as HoppRESTAuthJWT
}

const authTypes: AuthType[] = [
  {
    key: "inherit",
    label: "Inherit",
  },
  {
    key: "none",
    label: "None",
  },
  {
    key: "basic",
    label: "Basic Auth",
  },
  {
    key: "digest",
    label: "Digest Auth",
    handler: selectDigestAuthType,
  },
  {
    key: "bearer",
    label: "Bearer",
  },
  {
    key: "oauth-2",
    label: "OAuth 2.0",
    handler: selectOAuth2AuthType,
  },
  {
    key: "api-key",
    label: "API Key",
    handler: selectAPIKeyAuthType,
  },
  {
    key: "aws-signature",
    label: "AWS Signature",
    handler: selectAWSSignatureAuthType,
  },
  {
    key: "hawk",
    label: "HAWK",
    handler: selectHAWKAuthType,
  },
  {
    key: "jwt",
    label: "JWT",
    handler: selectJWTAuthType,
  },
]

const authType = pluckRef(auth, "authType")
const getAuthName = (type: HoppRESTAuth["authType"] | undefined) => {
  if (!type) return "None"
  return authTypes.find((a) => a.key === type)?.label || "None"
}
const authName = computed(() => getAuthName(authType.value))

function selectOAuth2AuthType() {
  const defaultGrantTypeInfo: HoppRESTAuthOAuth2["grantTypeInfo"] = {
    ...getDefaultAuthCodeOauthFlowParams(),
    grantType: "AUTHORIZATION_CODE",
    token: "",
  }

  // @ts-expect-error - the existing grantTypeInfo might be in the auth object, typescript doesnt know that
  const existingGrantTypeInfo = auth.value.grantTypeInfo as
    HoppRESTAuthOAuth2["grantTypeInfo"] | undefined

  const grantTypeInfo = existingGrantTypeInfo
    ? existingGrantTypeInfo
    : defaultGrantTypeInfo

  auth.value = {
    ...auth.value,
    authType: "oauth-2",
    addTo: "HEADERS",
    grantTypeInfo: grantTypeInfo,
  }
}

const authActive = pluckRef(auth, "authActive")

const clearContent = () => {
  auth.value = {
    authType: "inherit",
    authActive: true,
  }
}

// Template refs
const tippyActions = ref<any | null>(null)
</script>
