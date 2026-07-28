// The global `assistantEnabled` Redux flag means "the assistant is switched on in the chat the
// user is currently looking at". Every legitimate writer (the bot button, start/stop chatting,
// the bot options modal, ChatInput) dispatches it from inside a mounted Chat DV, so "the current
// chat" was implicit and good enough.
//
// Two writers break that assumption: `createBotQuickTopic` and `generateTaskFromPreConfig` in
// `utils/assistantHelper.js` arm the flag for a chat that was JUST created and that the user may
// never be taken to (`skipNavigation: true` — the My Day assistant line and the pre-config task
// search modal). The flag then sat `true` in the store until some Chat DV unmounted, so the next
// chat the user opened inherited assistant-enabled UI state it never asked for (AT-2084).
//
// That is not merely cosmetic: `ChatInput` folds the global flag into `explicitAssistantEnabled`,
// which OVERRIDES the persisted `isAssistantEnabled` of the object inside `createObjectMessage`.
// A leaked `true` therefore fires a real assistant run — and spends Gold — in a chat where the
// user had explicitly turned the assistant off.
//
// The fix mirrors the chat-scoped bot spinner trigger: the flag may carry the identity of the
// chat it was armed for, and readers that know which chat they are rendering ignore a flag that
// belongs to a different one.

// An explicit scope is `{ projectId, objectId }`; anything incomplete is normalized to `null`.
export const buildAssistantEnabledScope = (projectId, objectId) =>
    projectId && objectId ? { projectId, objectId } : null

export const normalizeAssistantEnabledScope = scope =>
    scope && typeof scope === 'object' && scope.projectId && scope.objectId
        ? { projectId: scope.projectId, objectId: scope.objectId }
        : null

// An UNSCOPED flag (`null` scope) is honored everywhere on purpose: that is what every in-chat
// writer produces, and those are always talking about the chat that is currently open. Only a
// flag that explicitly names a different chat is rejected.
export const isAssistantEnabledScopeMatch = (scope, projectId, objectId) => {
    const normalized = normalizeAssistantEnabledScope(scope)
    if (!normalized) return true
    if (!projectId || !objectId) return false
    return normalized.projectId === projectId && normalized.objectId === objectId
}

// Reader-side selector: the global flag as seen by one specific chat.
export const selectAssistantEnabledFor = (state, projectId, objectId) =>
    state.assistantEnabled === true && isAssistantEnabledScopeMatch(state.assistantEnabledScope, projectId, objectId)
