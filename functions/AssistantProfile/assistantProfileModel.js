'use strict'

// The assistant profile (AT-3072): what a user's own assistants should know about them, kept up to
// date every night from what the user did, the way the project wiki keeps up with its project. It
// replaced the recurring assistant task "User Description Update", which posted a message every day
// and wrote into the global user description, a field every member of a shared project can read
// (users/{uid} is readable by co-members, and a member profile falls back to it). The profile holds
// what the user did in all their projects, so it is private:
//
//   assistantProfiles/{uid}                  settings, the current text, run state
//   assistantProfiles/{uid}/revisions/{id}   every version of the text, with what changed
//   assistantProfiles/{uid}/runs/{runId}     nightly runs (the log, and what they cost)
//
// Only the user reads this tree (firestore.rules); only Cloud Functions write it, settings and
// manual edits included (assistantProfileSettings.js). The text goes into the user's own assistant
// runs next to the global description (getUserDescriptionContextMessage in assistantHelper.js) and
// nowhere else: not into another member's runs, not into the Updates feed, not into search.

const {
    SELECTABLE_ASSISTANT_MODELS,
    normalizeSelectableAssistantModelKey,
} = require('../Assistant/selectableAssistantModels')

const ASSISTANT_PROFILES_COLLECTION = 'assistantProfiles'
const ASSISTANT_PROFILE_REVISIONS_COLLECTION = 'revisions'
const ASSISTANT_PROFILE_RUNS_COLLECTION = 'runs'

// The text rides in every one of the user's assistant runs, so it stays short. The default format
// asks for about 2000 characters; the store refuses more than this.
const ASSISTANT_PROFILE_MAX_CHARS = 4000
const ASSISTANT_PROFILE_INSTRUCTIONS_MAX_CHARS = 2000
const ASSISTANT_PROFILE_SUMMARY_MAX_CHARS = 300

const DEFAULT_ASSISTANT_PROFILE_MODEL = 'MODEL_DEEPSEEK_V4_FLASH'
// One run a night with at most ~14,000 tokens of input is about 8 Gold at DeepSeek V4 Flash's 2,000
// tokens per Gold, so 300 covers a month of busy days with room for a few "update now" presses.
const DEFAULT_ASSISTANT_PROFILE_MONTHLY_GOLD_CAP = 300
const MIN_ASSISTANT_PROFILE_MONTHLY_GOLD_CAP = 30
const MAX_ASSISTANT_PROFILE_MONTHLY_GOLD_CAP = 10000
const ASSISTANT_PROFILE_REFRESH_COOLDOWN_MS = 10 * 60 * 1000

// Who switched it on. The default may resume a profile it switched on; a choice the user made
// (on or off) is never undone by it.
const ASSISTANT_PROFILE_ENABLED_BY_DEFAULT = 'default'
const ASSISTANT_PROFILE_ENABLED_BY_USER = 'user'

const ASSISTANT_PROFILE_OWNER_INACTIVE_STOP_REASON = 'owner_inactive'
const ASSISTANT_PROFILE_MONTHLY_CAP_STOP_REASON = 'monthly_cap'
const ASSISTANT_PROFILE_INSUFFICIENT_GOLD_STOP_REASON = 'insufficient_gold'

// What a revision came from.
const ASSISTANT_PROFILE_REVISION_MODES = ['run', 'user', 'restore']

// What a run reads. Each can be switched off in the settings; a missing map means all on.
const ASSISTANT_PROFILE_SOURCE_KEYS = ['memory', 'tasks', 'goals', 'notes', 'contacts', 'chats']

// The format the profile is written in unless the user's own instructions say otherwise. It is the
// structure the recurring "User Description Update" task used: a stable paragraph, what is on the
// user's mind now, and older context that moves down and shrinks as it ages.
const DEFAULT_ASSISTANT_PROFILE_FORMAT = [
    'Write the profile in this structure, in the language the user mostly writes in:',
    'User description: one paragraph with the most important, lasting facts about the user (role, work, projects, how they like to work).',
    'Top of mind: what the user is working on right now, upcoming goals, milestones and dates.',
    'Recent months: things that are no longer top of mind. Put the month on each entry (e.g. "Nov 2026") so it can later move down.',
    'Long-term background: things older than a few months that still matter. Keep it short and drop what no longer matters.',
    'Keep the whole profile under about 2000 characters.',
].join('\n')

function getAssistantProfilePath(userId) {
    return `${ASSISTANT_PROFILES_COLLECTION}/${userId}`
}

function getAssistantProfileRevisionsPath(userId) {
    return `${getAssistantProfilePath(userId)}/${ASSISTANT_PROFILE_REVISIONS_COLLECTION}`
}

function getAssistantProfileRunsPath(userId) {
    return `${getAssistantProfilePath(userId)}/${ASSISTANT_PROFILE_RUNS_COLLECTION}`
}

// A revision's id sorts by revision number and cannot collide: two writers of the same number fail
// on the create, which is what the store relies on.
function getAssistantProfileRevisionId(revision) {
    return `r${String(Math.max(0, Math.floor(Number(revision) || 0))).padStart(6, '0')}`
}

// A stored model key is validated on every read, never trusted: an unknown key would run at some
// default model while its Gold rate resolves to nothing.
function resolveAssistantProfileModel(storedModel) {
    const normalized = normalizeSelectableAssistantModelKey(storedModel)
    return SELECTABLE_ASSISTANT_MODELS.some(option => option.model === normalized)
        ? normalized
        : DEFAULT_ASSISTANT_PROFILE_MODEL
}

function resolveAssistantProfileMonthlyGoldCap(storedCap) {
    const cap = Number(storedCap)
    if (!Number.isInteger(cap)) return DEFAULT_ASSISTANT_PROFILE_MONTHLY_GOLD_CAP
    return Math.min(MAX_ASSISTANT_PROFILE_MONTHLY_GOLD_CAP, Math.max(MIN_ASSISTANT_PROFILE_MONTHLY_GOLD_CAP, cap))
}

function resolveAssistantProfileSources(storedSources) {
    const stored = storedSources && typeof storedSources === 'object' ? storedSources : {}
    return Object.fromEntries(ASSISTANT_PROFILE_SOURCE_KEYS.map(key => [key, stored[key] !== false]))
}

function normalizeAssistantProfileText(value) {
    return typeof value === 'string' ? value.replace(/\r\n/g, '\n').trim() : ''
}

class AssistantProfileSettingsError extends Error {}

// Validates what the user may change. Unknown fields are ignored so an older client cannot break the
// call; every field present is validated strictly.
function normalizeAssistantProfileSettingsInput(input) {
    const settings = input && typeof input === 'object' ? input : {}
    const patch = {}

    if (settings.enabled !== undefined) {
        if (typeof settings.enabled !== 'boolean') throw new AssistantProfileSettingsError('enabled must be a boolean.')
        patch.enabled = settings.enabled
    }

    if (settings.instructions !== undefined) {
        if (typeof settings.instructions !== 'string') {
            throw new AssistantProfileSettingsError('instructions must be a string.')
        }
        const instructions = settings.instructions.trim()
        if (instructions.length > ASSISTANT_PROFILE_INSTRUCTIONS_MAX_CHARS) {
            throw new AssistantProfileSettingsError(
                `instructions must be at most ${ASSISTANT_PROFILE_INSTRUCTIONS_MAX_CHARS} characters.`
            )
        }
        patch.instructions = instructions
    }

    if (settings.model !== undefined) {
        const model = normalizeSelectableAssistantModelKey(settings.model)
        if (!SELECTABLE_ASSISTANT_MODELS.some(option => option.model === model)) {
            throw new AssistantProfileSettingsError('model is not an available assistant model.')
        }
        patch.model = model
    }

    if (settings.monthlyGoldCap !== undefined) {
        const cap = Number(settings.monthlyGoldCap)
        if (
            !Number.isInteger(cap) ||
            cap < MIN_ASSISTANT_PROFILE_MONTHLY_GOLD_CAP ||
            cap > MAX_ASSISTANT_PROFILE_MONTHLY_GOLD_CAP
        ) {
            throw new AssistantProfileSettingsError(
                `monthlyGoldCap must be a whole number between ${MIN_ASSISTANT_PROFILE_MONTHLY_GOLD_CAP} and ${MAX_ASSISTANT_PROFILE_MONTHLY_GOLD_CAP}.`
            )
        }
        patch.monthlyGoldCap = cap
    }

    if (settings.sources !== undefined) {
        if (!settings.sources || typeof settings.sources !== 'object' || Array.isArray(settings.sources)) {
            throw new AssistantProfileSettingsError('sources must be an object.')
        }
        const sources = {}
        for (const [key, value] of Object.entries(settings.sources)) {
            if (!ASSISTANT_PROFILE_SOURCE_KEYS.includes(key)) continue
            if (typeof value !== 'boolean') throw new AssistantProfileSettingsError(`sources.${key} must be a boolean.`)
            sources[key] = value
        }
        patch.sources = sources
    }

    if (settings.text !== undefined) {
        if (typeof settings.text !== 'string') throw new AssistantProfileSettingsError('text must be a string.')
        const text = normalizeAssistantProfileText(settings.text)
        if (text.length > ASSISTANT_PROFILE_MAX_CHARS) {
            throw new AssistantProfileSettingsError(`text must be at most ${ASSISTANT_PROFILE_MAX_CHARS} characters.`)
        }
        patch.text = text
    }

    return patch
}

// The month the Gold counter belongs to. UTC, like the reset on the first of the month.
function getAssistantProfileMonthKey(now = Date.now()) {
    return new Date(now).toISOString().slice(0, 7)
}

function getAssistantProfileMonthlyGoldSpent(data = {}, now = Date.now()) {
    return data?.monthlyGold?.month === getAssistantProfileMonthKey(now) ? Number(data.monthlyGold.spent) || 0 : 0
}

// A run for a user who has not used Alldone for 30 days stops and clears nextRunAt; their return
// (assistantProfileDefaults.js) schedules it again.
function isAssistantProfilePausedForInactiveOwner(data = {}) {
    return (
        data.enabled === true &&
        !Number.isFinite(data.nextRunAt) &&
        data.lastRunStopReason === ASSISTANT_PROFILE_OWNER_INACTIVE_STOP_REASON
    )
}

// A run that reaches the monthly cap waits for the first of next month; raising the cap above what
// the month has spent ends that early (assistantProfileSettings.js).
function isAssistantProfilePausedAtMonthlyCap(data = {}, now = Date.now()) {
    return (
        data.enabled === true &&
        data.lastRunStopReason === ASSISTANT_PROFILE_MONTHLY_CAP_STOP_REASON &&
        data.monthlyGold?.month === getAssistantProfileMonthKey(now) &&
        Number.isFinite(data.nextRunAt) &&
        data.nextRunAt > now
    )
}

// What the settings callables answer with. Run state (lease, cursor) stays out of it.
function toAssistantProfileSettingsView(userId, data = {}, now = Date.now()) {
    return {
        userId,
        exists: !!data && Object.keys(data).length > 0,
        enabled: data.enabled === true,
        enabledByDefault: data.enabled === true && data.enabledBy === ASSISTANT_PROFILE_ENABLED_BY_DEFAULT,
        pausedForInactiveOwner: isAssistantProfilePausedForInactiveOwner(data),
        pausedAtMonthlyCap: isAssistantProfilePausedAtMonthlyCap(data, now),
        text: normalizeAssistantProfileText(data.text),
        revision: Number.isFinite(data.revision) ? data.revision : 0,
        instructions: typeof data.instructions === 'string' ? data.instructions : '',
        model: resolveAssistantProfileModel(data.model),
        monthlyGoldCap: resolveAssistantProfileMonthlyGoldCap(data.monthlyGoldCap),
        monthlyGoldSpent: getAssistantProfileMonthlyGoldSpent(data, now),
        sources: resolveAssistantProfileSources(data.sources),
        nextRunAt: Number.isFinite(data.nextRunAt) ? data.nextRunAt : null,
        lastRunAt: Number.isFinite(data.lastRunAt) ? data.lastRunAt : null,
        lastRunStatus: typeof data.lastRunStatus === 'string' ? data.lastRunStatus : null,
        lastRunStopReason: typeof data.lastRunStopReason === 'string' ? data.lastRunStopReason : null,
        lastChangedAt: Number.isFinite(data.textUpdatedAt) ? data.textUpdatedAt : null,
    }
}

module.exports = {
    ASSISTANT_PROFILES_COLLECTION,
    ASSISTANT_PROFILE_REVISIONS_COLLECTION,
    ASSISTANT_PROFILE_RUNS_COLLECTION,
    ASSISTANT_PROFILE_MAX_CHARS,
    ASSISTANT_PROFILE_INSTRUCTIONS_MAX_CHARS,
    ASSISTANT_PROFILE_SUMMARY_MAX_CHARS,
    DEFAULT_ASSISTANT_PROFILE_MODEL,
    DEFAULT_ASSISTANT_PROFILE_MONTHLY_GOLD_CAP,
    MIN_ASSISTANT_PROFILE_MONTHLY_GOLD_CAP,
    MAX_ASSISTANT_PROFILE_MONTHLY_GOLD_CAP,
    ASSISTANT_PROFILE_REFRESH_COOLDOWN_MS,
    ASSISTANT_PROFILE_ENABLED_BY_DEFAULT,
    ASSISTANT_PROFILE_ENABLED_BY_USER,
    ASSISTANT_PROFILE_OWNER_INACTIVE_STOP_REASON,
    ASSISTANT_PROFILE_MONTHLY_CAP_STOP_REASON,
    ASSISTANT_PROFILE_INSUFFICIENT_GOLD_STOP_REASON,
    ASSISTANT_PROFILE_REVISION_MODES,
    ASSISTANT_PROFILE_SOURCE_KEYS,
    DEFAULT_ASSISTANT_PROFILE_FORMAT,
    AssistantProfileSettingsError,
    getAssistantProfilePath,
    getAssistantProfileRevisionsPath,
    getAssistantProfileRunsPath,
    getAssistantProfileRevisionId,
    resolveAssistantProfileModel,
    resolveAssistantProfileMonthlyGoldCap,
    resolveAssistantProfileSources,
    normalizeAssistantProfileText,
    normalizeAssistantProfileSettingsInput,
    getAssistantProfileMonthKey,
    getAssistantProfileMonthlyGoldSpent,
    isAssistantProfilePausedForInactiveOwner,
    isAssistantProfilePausedAtMonthlyCap,
    toAssistantProfileSettingsView,
}
