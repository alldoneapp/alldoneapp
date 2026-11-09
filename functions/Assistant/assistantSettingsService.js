'use strict'

/**
 * Changing an assistant's settings, for both surfaces (CLAUDE.md, "MCP and assistant tools offer the
 * same features"): the assistant tool `update_assistant_settings` and the MCP tool `update_assistant`
 * validate and save the same fields here, with the same rules.
 *
 * Fields: displayName, description, instructions (the previous text is kept in instructionsHistory,
 * the newest 10 versions), model, temperature, realtimeVoice, delegationToolDescriptionManual. A
 * value equal to the stored one is not a change, and a call that changes nothing writes nothing.
 * When the instructions change, every scheduled task of the assistant that still runs on an
 * unchanged copy of the old instructions gets the new ones; a copy somebody edited stays.
 *
 * What differs per surface stays with the caller: who the target is (an assistant defaults to
 * itself), Tools Access (only the user, over MCP or in the app, never an assistant) and the project
 * assistant writes (MCP/mcpWorkspaceSetupTools.js, buildProjectAssistantWrites).
 */

const { SELECTABLE_ASSISTANT_MODELS } = require('./selectableAssistantModels')

const MAX_ASSISTANT_PROMPT_HISTORY = 10

// Every model a user can pick in the UI, plus legacy keys assistants configured on them must keep.
const LEGACY_ASSISTANT_SETTINGS_MODELS = [
    'MODEL_GPT5_5',
    'MODEL_GPT5_1',
    'MODEL_GPT5_2',
    'MODEL_GPT5_4_MINI',
    'MODEL_GPT5_4_NANO',
    'MODEL_SONAR',
    'MODEL_SONAR_PRO',
    'MODEL_SONAR_REASONING',
    'MODEL_SONAR_REASONING_PRO',
]
const ASSISTANT_SETTINGS_MODELS = [
    ...SELECTABLE_ASSISTANT_MODELS.map(option => option.model),
    ...LEGACY_ASSISTANT_SETTINGS_MODELS,
]
const ASSISTANT_SETTINGS_TEMPERATURES = [
    'TEMPERATURE_VERY_LOW',
    'TEMPERATURE_LOW',
    'TEMPERATURE_NORMAL',
    'TEMPERATURE_HIGH',
    'TEMPERATURE_VERY_HIGH',
]
const ASSISTANT_SETTINGS_REALTIME_VOICES = [
    'alloy',
    'ash',
    'ballad',
    'coral',
    'echo',
    'sage',
    'shimmer',
    'verse',
    'marin',
    'cedar',
]
const ASSISTANT_SETTINGS_FIELDS = [
    'displayName',
    'description',
    'instructions',
    'model',
    'temperature',
    'realtimeVoice',
    'delegationToolDescriptionManual',
]

class AssistantSettingsError extends Error {}

const fail = message => {
    throw new AssistantSettingsError(message)
}

const hasOwn = (object, key) => Object.prototype.hasOwnProperty.call(object || {}, key)

// ---- prompt history (also used for the heartbeat prompt) -----------------------------------------

function getPromptHistoryValue(entry, promptField) {
    if (!entry) return ''
    if (typeof entry[promptField] === 'string') return entry[promptField]
    if (typeof entry.prompt === 'string') return entry.prompt
    if (promptField === 'instructions' && typeof entry.instructions === 'string') return entry.instructions
    if (promptField === 'heartbeatPrompt' && typeof entry.heartbeatPrompt === 'string') return entry.heartbeatPrompt
    return ''
}

function buildAssistantPromptHistoryEntry(promptField, prompt, replacedAt, replacedByUserId, replacedByAssistantId) {
    return {
        prompt,
        [promptField]: prompt,
        replacedAt,
        replacedByUserId: replacedByUserId || null,
        replacedByAssistantId: replacedByAssistantId || null,
    }
}

/**
 * The history after replacing `currentPrompt` with `nextPrompt`: the replaced text first, at most
 * MAX_ASSISTANT_PROMPT_HISTORY entries, never an entry equal to the new text.
 */
function buildPromptHistory({ currentPrompt, existingHistory, nextPrompt, promptField, now, userId, assistantId }) {
    if (currentPrompt === nextPrompt) return { changed: false, history: existingHistory || [] }
    const history = [
        buildAssistantPromptHistoryEntry(promptField, currentPrompt, now, userId, assistantId),
        ...(Array.isArray(existingHistory) ? existingHistory : []),
    ]
        .filter(entry => getPromptHistoryValue(entry, promptField) !== nextPrompt)
        .slice(0, MAX_ASSISTANT_PROMPT_HISTORY)
    return { changed: true, history }
}

// ---- validation -----------------------------------------------------------------------------------

/**
 * The validated changes `input` makes to `current`. Only keys present in `input` are considered;
 * a value equal to the stored one is left out. Pure.
 */
function buildAssistantSettingsPatch(current = {}, input = {}, { normalizeModel = value => value } = {}) {
    const patch = {}
    const updatedFields = []
    const set = (field, value, stored) => {
        if (value === stored) return
        patch[field] = value
        updatedFields.push(field)
    }

    if (hasOwn(input, 'displayName')) {
        if (typeof input.displayName !== 'string' || !input.displayName.trim()) {
            fail('displayName must be a non-empty string.')
        }
        set('displayName', input.displayName.trim(), current.displayName)
    }
    if (hasOwn(input, 'description')) {
        if (typeof input.description !== 'string') fail('description must be a string.')
        set('description', input.description, current.description || '')
    }
    if (hasOwn(input, 'instructions')) {
        if (typeof input.instructions !== 'string' || !input.instructions.trim()) {
            fail('instructions must be a non-empty string.')
        }
        set('instructions', input.instructions, current.instructions || '')
    }
    if (hasOwn(input, 'model')) {
        const model = typeof input.model === 'string' ? normalizeModel(input.model.trim()) : ''
        if (!ASSISTANT_SETTINGS_MODELS.includes(model)) {
            fail(`model must be one of: ${ASSISTANT_SETTINGS_MODELS.join(', ')}`)
        }
        set('model', model, current.model)
    }
    if (hasOwn(input, 'temperature')) {
        const temperature = typeof input.temperature === 'string' ? input.temperature.trim() : ''
        if (!ASSISTANT_SETTINGS_TEMPERATURES.includes(temperature)) {
            fail(`temperature must be one of: ${ASSISTANT_SETTINGS_TEMPERATURES.join(', ')}`)
        }
        set('temperature', temperature, current.temperature)
    }
    if (hasOwn(input, 'realtimeVoice')) {
        const realtimeVoice = typeof input.realtimeVoice === 'string' ? input.realtimeVoice.trim() : ''
        if (!ASSISTANT_SETTINGS_REALTIME_VOICES.includes(realtimeVoice)) {
            fail(`realtimeVoice must be one of: ${ASSISTANT_SETTINGS_REALTIME_VOICES.join(', ')}`)
        }
        set('realtimeVoice', realtimeVoice, current.realtimeVoice)
    }
    if (hasOwn(input, 'delegationToolDescriptionManual')) {
        if (typeof input.delegationToolDescriptionManual !== 'string') {
            fail('delegationToolDescriptionManual must be a string.')
        }
        set(
            'delegationToolDescriptionManual',
            input.delegationToolDescriptionManual,
            current.delegationToolDescriptionManual || ''
        )
    }
    return { patch, updatedFields }
}

const hasAnyAssistantSettingsField = input => ASSISTANT_SETTINGS_FIELDS.some(field => hasOwn(input, field))

// ---- saving ---------------------------------------------------------------------------------------

/**
 * Writes `patch` (plus `extraUpdate`, e.g. editor stamps or Tools Access) to the assistant in one
 * transaction, moving replaced instructions into instructionsHistory.
 */
async function commitAssistantSettings({ db, ref, patch, extraUpdate = {}, requestUserId, actorAssistantId, now }) {
    return db.runTransaction(async transaction => {
        const snapshot = await transaction.get(ref)
        if (!snapshot.exists) fail('The assistant no longer exists.')
        const currentData = snapshot.data() || {}
        const update = { ...patch, ...extraUpdate }
        let historyLength = Array.isArray(currentData.instructionsHistory) ? currentData.instructionsHistory.length : 0
        if (hasOwn(patch, 'instructions')) {
            const history = buildPromptHistory({
                currentPrompt: typeof currentData.instructions === 'string' ? currentData.instructions : '',
                existingHistory: currentData.instructionsHistory,
                nextPrompt: patch.instructions,
                promptField: 'instructions',
                now,
                userId: requestUserId,
                assistantId: actorAssistantId,
            })
            if (history.changed) {
                update.instructionsHistory = history.history
                historyLength = history.history.length
            }
        }
        transaction.update(ref, update)
        return { historyLength, previousInstructions: currentData.instructions }
    })
}

/**
 * A scheduled task runs on its own copy of the instructions (aiSystemMessage). A copy that still
 * equals the old instructions follows the assistant; one somebody edited is left alone.
 */
async function propagateInstructionsToScheduledTasks({
    db,
    projectId,
    assistantId,
    previousInstructions,
    nextInstructions,
}) {
    if (
        typeof previousInstructions !== 'string' ||
        !previousInstructions ||
        previousInstructions === nextInstructions
    ) {
        return 0
    }
    // The settings are saved by now: a failure here must not report the whole update as failed.
    try {
        const tasks = await db.collection(`assistantTasks/${projectId}/${assistantId}`).get()
        const batch = db.batch()
        let count = 0
        ;((tasks && tasks.docs) || []).forEach(taskDoc => {
            if ((taskDoc.data() || {}).aiSystemMessage === previousInstructions) {
                batch.update(taskDoc.ref, { aiSystemMessage: nextInstructions })
                count += 1
            }
        })
        if (count > 0) await batch.commit()
        return count
    } catch (error) {
        console.warn('[assistant settings] scheduled tasks kept their old instructions', {
            projectId,
            assistantId,
            error: error.message,
        })
        return 0
    }
}

module.exports = {
    ASSISTANT_SETTINGS_FIELDS,
    ASSISTANT_SETTINGS_MODELS,
    ASSISTANT_SETTINGS_REALTIME_VOICES,
    ASSISTANT_SETTINGS_TEMPERATURES,
    AssistantSettingsError,
    LEGACY_ASSISTANT_SETTINGS_MODELS,
    MAX_ASSISTANT_PROMPT_HISTORY,
    buildAssistantPromptHistoryEntry,
    buildAssistantSettingsPatch,
    buildPromptHistory,
    commitAssistantSettings,
    getPromptHistoryValue,
    hasAnyAssistantSettingsField,
    propagateInstructionsToScheduledTasks,
}
