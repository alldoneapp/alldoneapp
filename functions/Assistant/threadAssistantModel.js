'use strict'

/**
 * Per-thread assistant model override (AT-2502).
 *
 * The model an assistant answers with is a property of the ASSISTANT, and changing it in the
 * assistant's own settings changes it everywhere at once. That is the wrong granularity for the
 * ordinary "this one conversation deserves the expensive model / this one is fine on the cheap
 * one" decision, which is why a thread can now pin its own model: open the assistant button in
 * the thread, pick a model, and only that thread moves.
 *
 * Storage mirrors the thread's assistant, deliberately. `assistantId` and `isAssistantEnabled`
 * already live on the thread's own host document — the task doc for a task thread, the chat
 * object for a topic, the note/goal/contact/skill doc for those — and the override is the same
 * kind of fact about the same thread, so it lives in the same place under
 * `assistantModelOverride`. Nothing new to authorize: whoever may already change the thread's
 * assistant may change its model, and the server resolves both from one document it is reading
 * anyway.
 *
 * Two rules make it safe to read a stored model back.
 *
 * A stored value is only honoured when it is still a CURRENT selectable model. This is the
 * calendar-routing lesson (see `featureModelPreferences.js`): a model key that was valid when it
 * was written can be retired later, and an unrecognised key does not fail loudly — `getModel`
 * silently answers `gpt-5.6-sol` while `getTokensPerGold` answers `undefined`, which
 * `calculateGoldCostFromTokens` turns into a charge of ZERO. A thread pinned to a retired key
 * would therefore run for free forever, invisibly. An override that no longer names a selectable
 * model is treated as absent, so the thread falls back to its assistant.
 *
 * And an override never OUTRANKS a model somebody chose for the specific piece of work. A
 * pre-configured task prompt carrying its own `aiModelOverride` was configured for that model
 * deliberately (a cheap summarizer, say), and the thread it happens to run in must not silently
 * upgrade or downgrade it. Precedence is therefore: the work's own model, then the thread, then
 * the assistant.
 *
 * Dependency-light on purpose (only the dependency-free model menu), so it can be required from
 * the client bundle and from Cloud Functions without pulling in `assistantHelper`.
 */

const { SELECTABLE_ASSISTANT_MODELS } = require('./selectableAssistantModels')

// The field on the thread's host document. Named for what it is rather than reusing the
// pre-configured task's `aiModelOverride`: that one is a property of a saved prompt and is
// copied around with it, while this one belongs to the conversation.
const THREAD_ASSISTANT_MODEL_FIELD = 'assistantModelOverride'

// The picker's "no override" entry. Shares the spelling used by the pre-configured task model
// picker so the two read identically to a user who meets both.
const INHERIT_ASSISTANT_MODEL = 'INHERIT_ASSISTANT_MODEL'

const THREAD_ASSISTANT_MODEL_OPTIONS = SELECTABLE_ASSISTANT_MODELS.map(({ model, labelKey, name, tokensPerGold }) => ({
    labelKey,
    name,
    value: model,
    tokensPerGold,
}))

function isSelectableThreadAssistantModel(modelKey) {
    return SELECTABLE_ASSISTANT_MODELS.some(option => option.model === modelKey)
}

// The friendly name ("Sol", "DeepSeek Flash") for a model key, or null. Used by the button row
// so the thread's current model is readable without opening the picker.
function getThreadAssistantModelName(modelKey) {
    const option = SELECTABLE_ASSISTANT_MODELS.find(entry => entry.model === modelKey)
    return option ? option.name : null
}

/**
 * The model this thread is pinned to, or null when it follows its assistant.
 *
 * `objectData` is the thread's host document (task / chat object / note / goal / contact /
 * skill). Anything that is not a currently-selectable model key — absent, blank, a retired key,
 * a non-string — means "no override" rather than an error: an override is a convenience, and
 * losing it costs the user a click, whereas honouring an unknown key costs correct billing.
 */
function getThreadAssistantModelOverride(objectData) {
    const model = objectData?.[THREAD_ASSISTANT_MODEL_FIELD]
    if (typeof model !== 'string') return null
    const trimmed = model.trim()
    if (!trimmed || !isSelectableThreadAssistantModel(trimmed)) return null
    return trimmed
}

// What the picker should show as selected: the pinned model, else the inherit entry.
function getThreadAssistantModelSelection(objectData) {
    return getThreadAssistantModelOverride(objectData) || INHERIT_ASSISTANT_MODEL
}

// A picker choice on its way to storage. The inherit entry (and anything unrecognised) clears
// the override rather than writing a value the resolver would refuse to read back.
function normalizeThreadAssistantModelSelection(selection) {
    if (typeof selection !== 'string') return null
    const trimmed = selection.trim()
    if (!trimmed || trimmed === INHERIT_ASSISTANT_MODEL) return null
    return isSelectableThreadAssistantModel(trimmed) ? trimmed : null
}

/**
 * The model a run in this thread should use, and where it came from.
 *
 * `explicitModel` is a model chosen for the work itself (a pre-configured task's own
 * `aiModelOverride`). It wins, because it was configured for that prompt rather than for this
 * conversation. `threadOverride` is this module's field; `assistantModel` is the assistant's own
 * setting and the behaviour when no override exists — unchanged from before AT-2502.
 *
 * The returned `source` is only for logging; every caller uses `model`.
 */
function resolveThreadAssistantModel({ explicitModel, threadOverride, assistantModel } = {}) {
    const explicit = typeof explicitModel === 'string' && explicitModel.trim() ? explicitModel.trim() : null
    if (explicit) return { model: explicit, source: 'explicit' }

    const thread = normalizeThreadAssistantModelSelection(threadOverride)
    if (thread) return { model: thread, source: 'thread_override' }

    const assistant = typeof assistantModel === 'string' && assistantModel.trim() ? assistantModel.trim() : null
    return { model: assistant, source: 'assistant' }
}

module.exports = {
    INHERIT_ASSISTANT_MODEL,
    THREAD_ASSISTANT_MODEL_FIELD,
    THREAD_ASSISTANT_MODEL_OPTIONS,
    getThreadAssistantModelName,
    getThreadAssistantModelOverride,
    getThreadAssistantModelSelection,
    isSelectableThreadAssistantModel,
    normalizeThreadAssistantModelSelection,
    resolveThreadAssistantModel,
}
