'use strict'

/**
 * Updates-feed entries for the workspace changes MCP clients and assistants make (decision
 * 2026-11-09: every change made over MCP shows in Updates; assistants run the same code, so theirs
 * do too): projects created, contact statuses added, the project assistant switched, assistants
 * created and changed, heartbeat settings, and scheduled assistant tasks.
 *
 * The app writes most of these entries itself when a person makes the change in its screens
 * (utils/backends/Assistants/assistantUpdates.js, utils/backends/Projects/projectUpdates.js); the
 * types and texts here are the same, so both read alike. Things the app has no entry type for
 * (voice, delegation description, Tools Access, heartbeat, scheduled tasks, contact statuses) get
 * their own types on the object they belong to: an assistant or the project.
 *
 * Best-effort, like Goals/goalToolFeeds.js: it runs after the change is stored, loads the feed state
 * the helpers read, and a failure is logged and never fails the change. A global assistant
 * (globalProject) gets no entries, as in the app.
 */

const {
    FEED_ASSISTANT_CREATED,
    FEED_ASSISTANT_NAME_CHANGED,
    FEED_ASSISTANT_DESCRIPTION_CHANGED,
    FEED_ASSISTANT_PICTURE_CHANGED,
    FEED_ASSISTANT_INSTRUCTIONS_CHANGED,
    FEED_ASSISTANT_MODEL_CHANGED,
    FEED_ASSISTANT_TEMPERATURE_CHANGED,
    FEED_ASSISTANT_VOICE_CHANGED,
    FEED_ASSISTANT_DELEGATION_DESCRIPTION_CHANGED,
    FEED_ASSISTANT_TOOLS_CHANGED,
    FEED_ASSISTANT_HEARTBEAT_CHANGED,
    FEED_ASSISTANT_TASK_CREATED,
    FEED_ASSISTANT_TASK_CHANGED,
    FEED_PROJECT_CREATED,
    FEED_PROJECT_ASSISTANT_CHANGED,
    FEED_PROJECT_CONTACT_STATUSES_ADDED,
} = require('./FeedsConstants')

const GLOBAL_PROJECT_ID = 'globalProject'
const TEXT_LIMIT = 80

const shrink = (text, limit = TEXT_LIMIT) => {
    const { shrinkTagText } = require('../Utils/parseTextUtils')
    const value = typeof text === 'string' ? text : ''
    return shrinkTagText(value, limit) || '(empty)'
}

// The same labels the app's feeds use (assistantUpdates.js getModelText / getTemperature).
function getModelLabel(modelKey) {
    const { SELECTABLE_ASSISTANT_MODELS } = require('../Assistant/selectableAssistantModels')
    const selectable = SELECTABLE_ASSISTANT_MODELS.find(option => option.model === modelKey)
    if (selectable) return selectable.labelKey
    const legacy = {
        MODEL_GPT5_1: 'GPT 5_1',
        MODEL_GPT5_2: 'GPT 5_2',
        MODEL_GPT5_5: 'GPT 5_5',
        MODEL_GPT5_6_SOL: 'GPT 6.1 Sol',
        MODEL_GPT5_6_LUNA: 'GPT 6 Luna',
        MODEL_SONAR: 'Sonar',
        MODEL_SONAR_PRO: 'Sonar Pro',
        MODEL_SONAR_REASONING: 'Sonar Reasoning',
        MODEL_SONAR_REASONING_PRO: 'Sonar Reasoning Pro',
    }
    return legacy[modelKey] || modelKey || ''
}

const TEMPERATURE_LABELS = {
    TEMPERATURE_VERY_LOW: 0.2,
    TEMPERATURE_LOW: 0.5,
    TEMPERATURE_NORMAL: 0.7,
    TEMPERATURE_HIGH: 1,
    TEMPERATURE_VERY_HIGH: 1.3,
}
const getTemperatureLabel = key => (key in TEMPERATURE_LABELS ? TEMPERATURE_LABELS[key] : key || '')

const listText = (items, limit = 6) => {
    const shown = items.slice(0, limit).join(', ')
    return items.length > limit ? `${shown} +${items.length - limit}` : shown
}

/**
 * The entries a change of assistant settings makes, in the order they happened to the fields.
 * Pure: `before` and `after` are the assistant document before and after the change.
 */
function describeAssistantChanges(before = {}, after = {}) {
    const entries = []
    // An absent field and an empty one are the same value: a stored '' must not read as a change.
    const normalize = value => (value === undefined || value === null || value === '' ? null : value)
    const changed = field => JSON.stringify(normalize(before[field])) !== JSON.stringify(normalize(after[field]))
    const fromTo = (field, label = value => shrink(value)) =>
        `From ${label(before[field] || '')} to ${label(after[field] || '')}`

    if (changed('displayName')) {
        entries.push({
            feedType: FEED_ASSISTANT_NAME_CHANGED,
            entryText: `changed assistant name • ${fromTo('displayName')}`,
            feedObject: { name: after.displayName || '' },
        })
    }
    if (changed('description')) {
        entries.push({
            feedType: FEED_ASSISTANT_DESCRIPTION_CHANGED,
            entryText: `changed assistant description • ${fromTo('description', value => shrink(value, 50))}`,
        })
    }
    if (changed('photoURL50') || changed('photoURL')) {
        const newPhotoURL = after.photoURL50 || after.photoURL || ''
        entries.push({
            feedType: FEED_ASSISTANT_PICTURE_CHANGED,
            entryText: '',
            feedFields: { newPhotoURL, oldPhotoURL: before.photoURL50 || before.photoURL || '' },
            feedObject: { photoURL: newPhotoURL },
        })
    }
    if (changed('instructions')) {
        entries.push({
            feedType: FEED_ASSISTANT_INSTRUCTIONS_CHANGED,
            entryText: `changed assistant instructions • ${fromTo('instructions')}`,
        })
    }
    if (changed('model')) {
        entries.push({
            feedType: FEED_ASSISTANT_MODEL_CHANGED,
            entryText: `changed assistant model • ${fromTo('model', getModelLabel)}`,
        })
    }
    if (changed('temperature')) {
        entries.push({
            feedType: FEED_ASSISTANT_TEMPERATURE_CHANGED,
            entryText: `changed assistant temperature • ${fromTo('temperature', getTemperatureLabel)}`,
        })
    }
    if (changed('realtimeVoice')) {
        entries.push({
            feedType: FEED_ASSISTANT_VOICE_CHANGED,
            entryText: `changed assistant voice • ${fromTo('realtimeVoice', value => value || 'marin')}`,
        })
    }
    if (changed('delegationToolDescriptionManual')) {
        entries.push({
            feedType: FEED_ASSISTANT_DELEGATION_DESCRIPTION_CHANGED,
            entryText: `changed how other assistants see this assistant • ${fromTo('delegationToolDescriptionManual')}`,
        })
    }
    if (changed('allowedTools')) {
        const beforeTools = Array.isArray(before.allowedTools) ? before.allowedTools : []
        const afterTools = Array.isArray(after.allowedTools) ? after.allowedTools : []
        const added = afterTools.filter(key => !beforeTools.includes(key))
        const removed = beforeTools.filter(key => !afterTools.includes(key))
        const parts = []
        if (added.length > 0) parts.push(`switched on ${listText(added)}`)
        if (removed.length > 0) parts.push(`switched off ${listText(removed)}`)
        if (parts.length > 0) {
            entries.push({
                feedType: FEED_ASSISTANT_TOOLS_CHANGED,
                entryText: `changed assistant tools • ${parts.join('; ')}`,
            })
        }
    }
    return entries
}

/** Text of a scheduled-task entry: what it is and, for a change, which fields moved. */
function describeAssistantTaskChange({ kind, taskName, changes = [] }) {
    const name = shrink(taskName || 'scheduled task', 60)
    if (kind === 'created') {
        return { feedType: FEED_ASSISTANT_TASK_CREATED, entryText: `created scheduled task • ${name}` }
    }
    const what = changes.length > 0 ? ` • ${listText(changes)}` : ''
    return { feedType: FEED_ASSISTANT_TASK_CHANGED, entryText: `changed scheduled task ${name}${what}` }
}

/**
 * The actor of an entry: the assistant when an assistant acted, otherwise the user, marked with the
 * MCP client when the change came over MCP (shared/mcpActor.js). Callers that already have it pass
 * `feedUser`.
 */
async function resolveFeedUser({ db, userId, projectId, context = {} }) {
    if (context.assistantId) {
        const paths = [
            `assistants/${projectId}/items/${context.assistantId}`,
            `assistants/${GLOBAL_PROJECT_ID}/items/${context.assistantId}`,
        ]
        for (const path of paths) {
            const snapshot = await db.doc(path).get()
            if (snapshot.exists) {
                const assistant = snapshot.data() || {}
                const name = assistant.displayName || 'Assistant'
                return {
                    uid: context.assistantId,
                    id: context.assistantId,
                    creatorId: context.assistantId,
                    name,
                    displayName: name,
                    email: '',
                    photoURL: assistant.photoURL50 || assistant.photoURL || '',
                }
            }
        }
    }
    const { UserHelper } = require('../shared/UserHelper')
    const { buildMcpActorMarker } = require('../shared/mcpActor')
    const user = await UserHelper.getFeedUserData(db, userId)
    return context.assistantId ? user : { ...user, ...buildMcpActorMarker(context.mcpClient) }
}

// `getFeedUser` lets a caller hand over its own actor lookup, run only when an entry is written.
async function prepare({ db, projectId, userId, feedUser, getFeedUser, context }) {
    const actor =
        feedUser ||
        (getFeedUser ? await getFeedUser() : null) ||
        (await resolveFeedUser({ db, userId, projectId, context }))
    const { loadFeedsStateForContactWrite } = require('../shared/contactUpdateHelper')
    await loadFeedsStateForContactWrite({ db, projectId, feedUser: actor, userId })
    const { BatchWrapper } = require('../BatchWrapper/batchWrapper')
    return { actor, batch: new BatchWrapper(db) }
}

// One entry on an object. `buildFeedObject` makes the object's feed state when it has none yet.
async function addEntry({ projectId, objectId, objectsType, buildFeedObject, entry, actor, batch }) {
    const {
        generateCurrentDateObject,
        generateFeedModel,
        loadFeedObject,
        proccessFeed,
    } = require('./globalFeedsHelper')
    const { currentDateFormated, currentMilliseconds } = generateCurrentDateObject()
    let feedObject = await loadFeedObject(projectId, objectId, objectsType, currentMilliseconds, batch)
    if (!feedObject) {
        feedObject = buildFeedObject(currentMilliseconds)
        batch.feedObjects = { ...batch.feedObjects, [objectId]: feedObject }
    }
    Object.assign(feedObject, entry.feedObject || {}, { lastChangeDate: currentMilliseconds })
    const { feed, feedId } = generateFeedModel({
        feedType: entry.feedType,
        lastChangeDate: currentMilliseconds,
        entryText: entry.entryText,
        feedUser: actor,
        objectId,
        isPublicFor: feedObject.isPublicFor,
    })
    Object.assign(feed, entry.feedFields || {})
    await proccessFeed(
        projectId,
        currentDateFormated,
        [],
        objectId,
        objectsType,
        feedObject,
        feedId,
        feed,
        actor,
        batch,
        false,
        entry.contextOverrides || {}
    )
}

const assistantFeedObjectBuilder = (assistant, assistantId) => currentMilliseconds => {
    const { generateAssistantObjectModel } = require('./assistantsFeedsHelper')
    return generateAssistantObjectModel(currentMilliseconds, assistant || {}, assistantId)
}

const projectFeedObjectBuilder = (project, projectId) => currentMilliseconds => {
    const { generateProjectObjectModel } = require('./projectsFeeds')
    return generateProjectObjectModel(currentMilliseconds, project || {}, projectId)
}

async function bestEffort(label, details, fn) {
    try {
        await fn()
        return true
    } catch (error) {
        console.warn(`[workspace feeds] ${label} entry was not written`, { ...details, error: error.message })
        return false
    }
}

async function readProject(db, projectId) {
    const snapshot = await db.doc(`projects/${projectId}`).get()
    return snapshot.exists ? snapshot.data() || {} : {}
}

/** Entries for a change of assistant settings, picture and Tools Access. */
async function writeAssistantChangeFeeds({
    db,
    projectId,
    assistantId,
    before,
    after,
    userId,
    feedUser,
    getFeedUser,
    context,
}) {
    if (!projectId || projectId === GLOBAL_PROJECT_ID) return false
    const entries = describeAssistantChanges(before, after)
    if (entries.length === 0) return false
    return bestEffort('assistant change', { projectId, assistantId }, async () => {
        const { actor, batch } = await prepare({ db, projectId, userId, feedUser, getFeedUser, context })
        for (const entry of entries) {
            await addEntry({
                projectId,
                objectId: assistantId,
                objectsType: 'assistants',
                buildFeedObject: assistantFeedObjectBuilder(after, assistantId),
                entry,
                actor,
                batch,
            })
        }
        await batch.commit()
    })
}

/** "created assistant" (+ its description), with the actor following the new assistant. */
async function writeAssistantCreatedFeeds({
    db,
    projectId,
    assistantId,
    assistant,
    userId,
    feedUser,
    getFeedUser,
    context,
}) {
    if (!projectId || projectId === GLOBAL_PROJECT_ID) return false
    return bestEffort('assistant created', { projectId, assistantId }, async () => {
        const { actor, batch } = await prepare({ db, projectId, userId, feedUser, getFeedUser, context })
        const { insertFollowersUserToFeedChain } = require('./globalFeedsHelper')
        insertFollowersUserToFeedChain([actor.uid], assistantId, batch)
        const entries = [{ feedType: FEED_ASSISTANT_CREATED, entryText: 'created assistant' }]
        if (assistant && typeof assistant.description === 'string' && assistant.description.trim()) {
            entries.push({
                feedType: FEED_ASSISTANT_DESCRIPTION_CHANGED,
                entryText: `changed assistant description • From (empty) to ${shrink(assistant.description, 50)}`,
            })
        }
        for (const entry of entries) {
            await addEntry({
                projectId,
                objectId: assistantId,
                objectsType: 'assistants',
                buildFeedObject: assistantFeedObjectBuilder(assistant, assistantId),
                entry,
                actor,
                batch,
            })
        }
        // The person who asked follows the new assistant, as when they create one in the app.
        const { FOLLOWER_ASSISTANTS_TYPE } = require('../Followers/FollowerConstants')
        const { tryAddFollower } = require('../Followers/followerHelper')
        const follower = context && context.assistantId ? await resolveFeedUser({ db, userId, projectId }) : actor
        await tryAddFollower(
            projectId,
            {
                followObjectsType: FOLLOWER_ASSISTANTS_TYPE,
                followObjectId: assistantId,
                followObject: assistant,
                feedUser: follower,
            },
            batch,
            false
        )
        await batch.commit()
    })
}

/** "changed heartbeat settings • <fields>" on the assistant. */
async function writeAssistantHeartbeatFeed({
    db,
    projectId,
    assistantId,
    assistant,
    changes = [],
    userId,
    feedUser,
    getFeedUser,
    context,
}) {
    if (!projectId || projectId === GLOBAL_PROJECT_ID || changes.length === 0) return false
    return bestEffort('heartbeat', { projectId, assistantId }, async () => {
        const { actor, batch } = await prepare({ db, projectId, userId, feedUser, getFeedUser, context })
        await addEntry({
            projectId,
            objectId: assistantId,
            objectsType: 'assistants',
            buildFeedObject: assistantFeedObjectBuilder(assistant, assistantId),
            entry: {
                feedType: FEED_ASSISTANT_HEARTBEAT_CHANGED,
                entryText: `changed heartbeat settings • ${listText(changes)}`,
            },
            actor,
            batch,
        })
        await batch.commit()
    })
}

/** A scheduled assistant task created or changed, on its assistant. */
async function writeAssistantTaskFeed({
    db,
    projectId,
    assistantId,
    assistant,
    kind,
    taskName,
    changes,
    userId,
    feedUser,
    getFeedUser,
    context,
}) {
    if (!projectId || projectId === GLOBAL_PROJECT_ID) return false
    if (kind !== 'created' && (!Array.isArray(changes) || changes.length === 0)) return false
    return bestEffort('scheduled task', { projectId, assistantId, kind }, async () => {
        const { actor, batch } = await prepare({ db, projectId, userId, feedUser, getFeedUser, context })
        let assistantData = assistant
        if (!assistantData) {
            const snapshot = await db.doc(`assistants/${projectId}/items/${assistantId}`).get()
            assistantData = snapshot.exists ? snapshot.data() || {} : {}
        }
        await addEntry({
            projectId,
            objectId: assistantId,
            objectsType: 'assistants',
            buildFeedObject: assistantFeedObjectBuilder(assistantData, assistantId),
            entry: describeAssistantTaskChange({ kind, taskName, changes }),
            actor,
            batch,
        })
        await batch.commit()
    })
}

/** "created project" on a project made over MCP (the app writes the same entry for its own form). */
async function writeProjectCreatedFeed({ db, projectId, project, userId, feedUser, getFeedUser, context }) {
    return bestEffort('project created', { projectId }, async () => {
        const { actor, batch } = await prepare({ db, projectId, userId, feedUser, getFeedUser, context })
        await addEntry({
            projectId,
            objectId: projectId,
            objectsType: 'projects',
            buildFeedObject: projectFeedObjectBuilder(project, projectId),
            entry: { feedType: FEED_PROJECT_CREATED, entryText: 'created project', contextOverrides: { project } },
            actor,
            batch,
        })
        await batch.commit()
    })
}

/** "changed project assistant" (the app's text), with the new assistant's name when there is one. */
async function writeProjectAssistantChangedFeed({
    db,
    projectId,
    assistantName,
    removed,
    userId,
    feedUser,
    getFeedUser,
    context,
}) {
    if (!projectId || projectId === GLOBAL_PROJECT_ID) return false
    return bestEffort('project assistant', { projectId }, async () => {
        const { actor, batch } = await prepare({ db, projectId, userId, feedUser, getFeedUser, context })
        const project = await readProject(db, projectId)
        const entryText = removed
            ? 'changed project assistant • removed the project assistant'
            : `changed project assistant${assistantName ? ` • ${shrink(assistantName, 50)}` : ''}`
        await addEntry({
            projectId,
            objectId: projectId,
            objectsType: 'projects',
            buildFeedObject: projectFeedObjectBuilder(project, projectId),
            entry: { feedType: FEED_PROJECT_ASSISTANT_CHANGED, entryText, contextOverrides: { project } },
            actor,
            batch,
        })
        await batch.commit()
    })
}

/** "added contact statuses • Lead, Customer" on the project. */
async function writeContactStatusesAddedFeed({
    db,
    projectId,
    statusNames = [],
    userId,
    feedUser,
    getFeedUser,
    context,
}) {
    if (!projectId || statusNames.length === 0) return false
    return bestEffort('contact statuses', { projectId }, async () => {
        const { actor, batch } = await prepare({ db, projectId, userId, feedUser, getFeedUser, context })
        const project = await readProject(db, projectId)
        await addEntry({
            projectId,
            objectId: projectId,
            objectsType: 'projects',
            buildFeedObject: projectFeedObjectBuilder(project, projectId),
            entry: {
                feedType: FEED_PROJECT_CONTACT_STATUSES_ADDED,
                entryText: `added contact ${statusNames.length === 1 ? 'status' : 'statuses'} • ${listText(
                    statusNames.map(name => shrink(name, 30))
                )}`,
                contextOverrides: { project },
            },
            actor,
            batch,
        })
        await batch.commit()
    })
}

module.exports = {
    describeAssistantChanges,
    describeAssistantTaskChange,
    resolveFeedUser,
    writeAssistantChangeFeeds,
    writeAssistantCreatedFeeds,
    writeAssistantHeartbeatFeed,
    writeAssistantTaskFeed,
    writeContactStatusesAddedFeed,
    writeProjectAssistantChangedFeed,
    writeProjectCreatedFeed,
}
