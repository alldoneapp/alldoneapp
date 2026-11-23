'use strict'

// Regular automatic update of the project description (AT-3095), the last step of a wiki run
// (knowledgeBaseIngest.js).
//
// The description (`projects/{id}.description`) is the project's short, durable profile: what the
// project is, what belongs in it and what does not, who is involved in which role, and standing
// rules for assistants. It rides as shared context in every chat and thread of the project and
// routing reads it, so it has to stay right; it is NOT a status report. The wiki holds the current
// state, compiled only from what the whole project may see (collectKnowledgeSources.js). This step
// reads the description and the wiki, and either keeps the description or saves a revised one.
//
// Why inside the wiki run rather than a pipeline of its own: the run already has the schedule (the
// payer's night), the payer, the monthly Gold cap, the lease, the pauses for a payer who is away,
// left or archived the project, the transient-retry logic and a source that is filtered for the
// project's audience. A project without a wiki therefore gets no automatic description update.
//
// Settings live on the wiki document, beside the wiki's own:
//   descriptionUpdate      { enabled, intervalDays: 1|7|14|28 }  what members chose; missing = on, weekly
//   descriptionUpdateState { lastRunAt, lastRunId, lastResult, lastChangedAt, inputsFingerprint }  run state
//
// When it runs: once the wiki run has caught up (no continuation pending), the interval since the
// last decision has passed, the wiki has at least one visible page, the project is active
// (`project.active !== false`), is no template, and the payer has not archived it. It may spend up to
// the wiki's whole monthly cap, like the health check (no reserve share since 2026-11-23). `lastRunAt` moves on only when the model DECIDED (saved, kept, or a conflict); a run that
// stopped or failed before that tries again on the next run, which is at most one conversation a
// night.
//
// Daily (added on review): due every night, but a night whose model inputs (the prompt rules with
// the wiki instructions, the description and the wiki material) are exactly what the last decision
// left behind is skipped with `no_changes`, before any model call and at no cost. The fingerprint of
// those inputs is stored with every decision (except a conflict, after which the member's text is
// new input anyway). The weekly and longer intervals do not use it: they run whenever they are due,
// as before.
//
// What a save does: `updateProjectDescription` (shared/projectDescriptionUpdateHelper.js), the same
// path the assistants' update_project_description tool takes, so the Updates feed gets the usual
// "changed description" line, attributed to the project's assistant. A text equal to the current one
// writes nothing and makes no feed line. The write is refused when the description changed since the
// run read it (a member's edit wins over the model's), and the save tool refuses a text that drops
// most of a substantial description or carries wiki links/citations.

const crypto = require('crypto')

const {
    DAILY_PROJECT_DESCRIPTION_UPDATE_INTERVAL_DAYS,
    DEFAULT_PROJECT_DESCRIPTION_UPDATE_INTERVAL_DAYS,
    DESCRIPTION_UPDATE_DUE_SLACK_MS,
    PROJECT_DESCRIPTION_UPDATE_INTERVAL_OPTIONS,
    getProjectDescriptionUpdateNextDueAt,
    isProjectDescriptionUpdateDue,
    resolveProjectDescriptionUpdateIntervalDays,
    resolveProjectDescriptionUpdateSettings,
} = require('./knowledgeBaseModel')

// What the model is shown of the wiki: the index plus as many page bodies as fit.
const DESCRIPTION_MATERIAL_MAX_CHARS = 40000
const DESCRIPTION_PAGE_MAX_CHARS = 4000
// A short profile. A longer description written by members may stay about as long as it is.
const PROJECT_DESCRIPTION_AUTO_MAX_CHARS = 2000
const PROJECT_DESCRIPTION_HARD_MAX_CHARS = 4000
// A revision that keeps less than this share of a substantial description is a rewrite, not a
// revision: refused, the model is told to keep what is still true.
const MIN_KEPT_SHARE = 0.5
const SUBSTANTIAL_DESCRIPTION_CHARS = 200

const DESCRIPTION_GOLD_SOURCE = 'project_description_update'

const DESCRIPTION_RESULT_CHANGED = 'changed'
const DESCRIPTION_RESULT_UNCHANGED = 'unchanged'
const DESCRIPTION_RESULT_CONFLICT = 'conflict'
const DESCRIPTION_RESULT_NO_DECISION = 'no_decision'

// Any [[…]] token: page links and source citations belong in the wiki, never in the description
// (a citation there could never be withdrawn, knowledgeSourceInvalidation.js).
const WIKI_TOKEN_REGEX = /\[\[([^[\]\n|]{1,200})(?:\|([^[\]\n]{1,200}))?\]\]/g

function normalizeDescription(value) {
    return typeof value === 'string' ? value.trim() : ''
}

// Why a due update is left out for this project, or null. Archived for the payer is per member
// (users/{uid}.archivedProjectIds); `project.active === false` is the project-wide flag.
function getProjectDescriptionUpdateSkipReason({ projectId, projectData = {}, ownerData = {} }) {
    if (projectData.active === false) return 'project_inactive'
    if (projectData.isTemplate === true) return 'template'
    if (Array.isArray(ownerData.archivedProjectIds) && ownerData.archivedProjectIds.includes(projectId)) {
        return 'project_archived'
    }
    return null
}

function stripWikiTokens(text) {
    return String(text || '').replace(WIKI_TOKEN_REGEX, (whole, inner, label) => (label || inner || '').trim())
}

function clip(text, maxChars) {
    const value = String(text || '').trim()
    return value.length > maxChars ? `${value.slice(0, maxChars).trimEnd()} …` : value
}

/**
 * The wiki as the model sees it for this step: every visible page in the index, and the bodies of
 * the most recently updated pages as far as the budget goes. Citations and links are flattened to
 * their labels so that nothing of the kind is copied into the description.
 */
function buildDescriptionWikiMaterial(pages, { maxChars = DESCRIPTION_MATERIAL_MAX_CHARS } = {}) {
    const visible = [...(pages instanceof Map ? pages.values() : pages || [])].filter(
        page => page && page.slug && page.archived !== true && page.needsRebuild !== true
    )
    const index = visible
        .slice()
        .sort((left, right) => String(left.title || left.slug).localeCompare(String(right.title || right.slug)))
        .map(page => `- ${page.title || page.slug}${page.summary ? ` — ${stripWikiTokens(page.summary)}` : ''}`)
    const sections = []
    let used = index.join('\n').length
    const byRecency = visible
        .slice()
        .sort((left, right) => (Number(right.updatedAt) || 0) - (Number(left.updatedAt) || 0))
    let omitted = 0
    for (const page of byRecency) {
        const section = `## ${page.title || page.slug}\n${clip(stripWikiTokens(page.body), DESCRIPTION_PAGE_MAX_CHARS)}`
        if (used + section.length + 2 > maxChars) {
            omitted += 1
            continue
        }
        sections.push(section)
        used += section.length + 2
    }
    return { pageCount: visible.length, index: index.join('\n'), sections, omitted }
}

const DESCRIPTION_RULES = [
    'What a project description is:',
    "- The project's short, durable profile: what the project is and why it exists, what belongs in it and what does not (and where that goes instead, if known), who is involved in which role, and standing rules for assistants working in it.",
    '- It is added as shared context to every chat and thread of the project, and routing reads it to place tasks, calendar events and emails in the right project. It must be reliable and short: a few sentences up to a few short paragraphs, well under 2000 characters.',
    '- It is NOT a status report: no weekly summary, no list of recent activity, no dated progress, no open task list, no meeting chronology. The wiki and the tasks hold the current state.',
    '',
    'How to revise it:',
    '- The current description is the base text, written by the project members. Keep everything in it that is still true, especially rules, boundaries and roles members wrote. Keep its language and its style.',
    '- Change it only where the wiki shows that the profile itself has changed or is incomplete: a new purpose or scope, a boundary that moved, a new person in a lasting role, someone who left, a standing rule members agreed on. Short-lived things do not count.',
    '- Remove a statement only when the wiki clearly shows it is no longer true.',
    '- Never invent anything the current description and the wiki do not support. Never copy wiki links, citations or source references.',
    '- If the description is empty, write a first short profile from the wiki, in the language the wiki is written in.',
    '- If nothing about the profile has changed, or you are unsure, call keep_project_description. Most weeks nothing needs to change.',
].join('\n')

function buildDescriptionSystemPrompt({ projectName, instructions }) {
    return [
        `You keep the project description of the project "${projectName}" in Alldone current.`,
        '',
        DESCRIPTION_RULES,
        '',
        `Instructions the project members gave for their wiki (they apply here as far as they concern the description): ${instructions || '(none)'}`,
        '',
        'Finish with exactly one call: save_project_description with the full revised text, or keep_project_description.',
    ].join('\n')
}

function buildDescriptionUserPrompt({ currentDescription, material }) {
    return [
        'Current project description:',
        currentDescription || '(empty)',
        '',
        `Project wiki: ${material.pageCount} pages.`,
        'Index:',
        material.index || '(empty)',
        '',
        'Pages, most recently updated first:',
        material.sections.join('\n\n') || '(none)',
        ...(material.omitted ? ['', `(${material.omitted} more pages are not shown.)`] : []),
    ].join('\n')
}

// What the model would see, as one hash: the system prompt (rules, project name, wiki instructions)
// and the user prompt for this description and wiki material. Stored with a decision so that the
// daily interval can tell a night with nothing new from one worth a model call.
function buildDescriptionInputsFingerprint({ systemPrompt, currentDescription, material }) {
    const userPrompt = buildDescriptionUserPrompt({
        currentDescription: normalizeDescription(currentDescription),
        material,
    })
    return crypto
        .createHash('sha256')
        .update(JSON.stringify([String(systemPrompt || ''), userPrompt]))
        .digest('hex')
}

// Daily only: true when neither the wiki, the description nor the instructions changed since the
// last decision, so this night is skipped without a model call.
function isDescriptionUpdateInputUnchanged(knowledgeBase = {}, fingerprint) {
    const { intervalDays } = resolveProjectDescriptionUpdateSettings(knowledgeBase)
    if (intervalDays !== DAILY_PROJECT_DESCRIPTION_UPDATE_INTERVAL_DAYS) return false
    const stored = knowledgeBase?.descriptionUpdateState?.inputsFingerprint
    return typeof stored === 'string' && stored.length > 0 && stored === fingerprint
}

function getProjectDescriptionMaxChars(currentDescription) {
    return Math.min(
        PROJECT_DESCRIPTION_HARD_MAX_CHARS,
        Math.max(PROJECT_DESCRIPTION_AUTO_MAX_CHARS, normalizeDescription(currentDescription).length + 300)
    )
}

// Why a proposed description is refused, or null when it may be saved.
function validateProposedDescription(proposed, currentDescription) {
    const text = normalizeDescription(proposed)
    if (!text) return 'The description must not be empty. Call keep_project_description to keep the current one.'
    const maxChars = getProjectDescriptionMaxChars(currentDescription)
    if (text.length > maxChars) {
        return `The description is ${text.length} characters long; it must stay under ${maxChars}. Keep it a short profile.`
    }
    if (/\[\[[^[\]\n]+\]\]/.test(text)) {
        return 'The description must not contain wiki links or citations ([[…]]). Write plain text.'
    }
    const current = normalizeDescription(currentDescription)
    if (current.length >= SUBSTANTIAL_DESCRIPTION_CHARS && text.length < current.length * MIN_KEPT_SHARE) {
        return 'This drops most of the current description. Revise it: keep every statement that is still true, and only change what the wiki shows has changed.'
    }
    return null
}

function buildDescriptionToolSchemas() {
    const schema = (name, description, properties, required) => ({
        type: 'function',
        function: { name, description, parameters: { type: 'object', properties, required } },
    })
    return {
        save_project_description: schema(
            'save_project_description',
            'Save the full revised project description. It replaces the current one and appears in the project feed.',
            {
                description: { type: 'string', description: 'The full revised description, plain text.' },
                reason: { type: 'string', description: 'One sentence: what changed in the profile and why.' },
            },
            ['description', 'reason']
        ),
        keep_project_description: schema(
            'keep_project_description',
            'Keep the current project description unchanged.',
            { reason: { type: 'string', description: 'One sentence: why nothing needs to change.' } },
            ['reason']
        ),
    }
}

/**
 * The two tools of this step. A decision is final: the first save or keep that succeeds ends the
 * step; later calls are refused. A save writes through `writeDescription` right away, so a stop
 * after the round (cap, time) does not lose a decision that was already paid for.
 */
function createDescriptionTools({ currentDescription, writeDescription, decision }) {
    const schemas = buildDescriptionToolSchemas()
    const decided = () =>
        decision.result ? { success: false, error: 'The description was already decided in this run.' } : null
    return {
        save_project_description: {
            schema: schemas.save_project_description,
            execute: async (args = {}) => {
                const already = decided()
                if (already) return already
                const proposed = normalizeDescription(args.description)
                const reason = normalizeDescription(args.reason).slice(0, 300)
                if (proposed && proposed === normalizeDescription(currentDescription)) {
                    Object.assign(decision, { result: DESCRIPTION_RESULT_UNCHANGED, reason })
                    return { success: true, updated: false, message: 'Same as the current description; nothing saved.' }
                }
                const refusal = validateProposedDescription(proposed, currentDescription)
                if (refusal) return { success: false, error: refusal }
                const written = await writeDescription({ description: proposed, reason })
                if (written.conflict) {
                    Object.assign(decision, { result: DESCRIPTION_RESULT_CONFLICT, reason })
                    return {
                        success: false,
                        error: 'A project member changed the description meanwhile; their version stays. Stop here.',
                    }
                }
                Object.assign(decision, {
                    result: written.updated ? DESCRIPTION_RESULT_CHANGED : DESCRIPTION_RESULT_UNCHANGED,
                    reason,
                    description: proposed,
                })
                return { success: true, updated: !!written.updated }
            },
        },
        keep_project_description: {
            schema: schemas.keep_project_description,
            execute: async (args = {}) => {
                const already = decided()
                if (already) return already
                Object.assign(decision, {
                    result: DESCRIPTION_RESULT_UNCHANGED,
                    reason: normalizeDescription(args.reason).slice(0, 300),
                })
                return { success: true, updated: false }
            },
        },
    }
}

// The project's assistant writes the feed line, so members see it was the automatic update and not
// the payer. Falls back to the payer when the project has no assistant.
async function resolveDescriptionFeedUser({ db, projectId, ownerUserId, ownerData = {} }) {
    const { UserHelper } = require('../shared/UserHelper')
    try {
        const { getDefaultAssistantIdForProject } = require('../shared/projectRoutingCommentHelper')
        const assistantId = await getDefaultAssistantIdForProject(
            { ...ownerData, defaultAssistantId: ownerData.defaultAssistantId || ownerData.assistantId },
            projectId
        )
        if (assistantId) {
            const { getAssistantForChat } = require('../Assistant/assistantHelper')
            const assistant = await getAssistantForChat(projectId, assistantId, ownerUserId)
            if (assistant) {
                const displayName = assistant.displayName || assistant.name || 'Assistant'
                const uid = assistant.uid || assistantId
                return {
                    uid,
                    id: uid,
                    creatorId: uid,
                    name: displayName,
                    displayName,
                    email: assistant.email || '',
                    photoURL: assistant.photoURL50 || assistant.photoURL300 || assistant.photoURL || '',
                }
            }
        }
    } catch (error) {
        console.warn('[project description] Could not resolve the project assistant for the feed', {
            projectId,
            error: error.message,
        })
    }
    return UserHelper.getFeedUserData(db, ownerUserId)
}

async function writeProjectDescriptionDefault({ db, projectId, ownerUserId, ownerData, description, expected }) {
    const { updateProjectDescription } = require('../shared/projectDescriptionUpdateHelper')
    const feedUser = await resolveDescriptionFeedUser({ db, projectId, ownerUserId, ownerData })
    return updateProjectDescription({
        db,
        projectId,
        userId: ownerUserId,
        description,
        feedUser,
        expectedDescription: expected,
    })
}

module.exports = {
    PROJECT_DESCRIPTION_UPDATE_INTERVAL_OPTIONS,
    DEFAULT_PROJECT_DESCRIPTION_UPDATE_INTERVAL_DAYS,
    DAILY_PROJECT_DESCRIPTION_UPDATE_INTERVAL_DAYS,
    DESCRIPTION_UPDATE_DUE_SLACK_MS,
    DESCRIPTION_GOLD_SOURCE,
    DESCRIPTION_RESULT_CHANGED,
    DESCRIPTION_RESULT_UNCHANGED,
    DESCRIPTION_RESULT_CONFLICT,
    DESCRIPTION_RESULT_NO_DECISION,
    PROJECT_DESCRIPTION_AUTO_MAX_CHARS,
    resolveProjectDescriptionUpdateIntervalDays,
    resolveProjectDescriptionUpdateSettings,
    getProjectDescriptionUpdateNextDueAt,
    isProjectDescriptionUpdateDue,
    getProjectDescriptionUpdateSkipReason,
    buildDescriptionWikiMaterial,
    buildDescriptionSystemPrompt,
    buildDescriptionUserPrompt,
    buildDescriptionInputsFingerprint,
    isDescriptionUpdateInputUnchanged,
    validateProposedDescription,
    createDescriptionTools,
    resolveDescriptionFeedUser,
    writeProjectDescriptionDefault,
}
