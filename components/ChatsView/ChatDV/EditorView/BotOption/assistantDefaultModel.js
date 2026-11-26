import {
    SELECTABLE_ASSISTANT_MODELS,
    normalizeSelectableAssistantModelKey,
} from '../../../../../functions/Assistant/selectableAssistantModels'

// What the server runs for an assistant without a model of its own (`normalizeModelKey` in
// `functions/Assistant/assistantModelRuntime.js`, which the client cannot import: it pulls in the
// OpenAI client). `functions/Assistant/assistantDefaultModelParity.test.js` holds the two in step.
export const ASSISTANT_FALLBACK_MODEL = 'MODEL_GPT6_SOL'

/**
 * The menu entry an ASSISTANT answers with when a chat follows it (AT-3162), or null.
 *
 * `assistantModel` is the assistant's stored `model` setting, never a chat's own override. It is
 * resolved the way the server resolves it rather than compared raw: an assistant saved before the
 * GPT-6 menu still stores `MODEL_GPT5_6_SOL` and runs on GPT 6.2 Sol, and one with no model at all
 * runs on Sol as well. A raw lookup named neither, which is why the picker's "Use assistant model"
 * row and the composer button showed no model for exactly those assistants.
 *
 * A key outside the current menu (a retired model the server still serves, such as GPT 5.5) gives
 * null, so callers show no name rather than a wrong one.
 *
 * Returns `{ model, name, labelKey }`: `name` is the short name ("Sol"), `labelKey` the menu's
 * translation key ("GPT 6.2 Sol"), the same label the picker's own rows show.
 */
export function getAssistantDefaultModelOption(assistantModel) {
    const stored = typeof assistantModel === 'string' ? assistantModel.trim() : ''
    const modelKey = stored ? normalizeSelectableAssistantModelKey(stored) : ASSISTANT_FALLBACK_MODEL
    const option = SELECTABLE_ASSISTANT_MODELS.find(entry => entry.model === modelKey)
    return option ? { model: option.model, name: option.name, labelKey: option.labelKey } : null
}

// The short name ("Sol") of the assistant's own model, or null.
export function getAssistantDefaultModelName(assistantModel) {
    return getAssistantDefaultModelOption(assistantModel)?.name || null
}
