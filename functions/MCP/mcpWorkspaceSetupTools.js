const admin = require('firebase-admin')
const moment = require('moment-timezone')
const { FieldValue } = require('firebase-admin/firestore')

const { generateSortIndex } = require('../Utils/HelperFunctionsCloud')
const { normalizeGoalMilestonesConfig } = require('../shared/goalMilestonesHelper')
const { TaskRetrievalService } = require('../shared/TaskRetrievalService')
const { buildLastEditorVia, buildMcpActorMarker } = require('../shared/mcpActor')
const {
    APPROVED_CONTENT_HASH_FIELD,
    computeAssistantTaskContentHash,
} = require('../Assistant/assistantTaskContentHash')
const {
    SELECTABLE_ASSISTANT_MODELS,
    normalizeSelectableAssistantModelKey,
} = require('../Assistant/selectableAssistantModels')

// ---------------------------------------------------------------------------
// Workspace setup over MCP
//
// The MCP server otherwise exposes no tool that creates or reconfigures a project or an assistant
// (see the header of mcpServerSimple.js). These four are the deliberate exception: they let an MCP
// client set up a working structure for the signed-in user, e.g. a project with a contact pipeline,
// an assistant and the recurring prompts it runs. Every write happens as that user, only in projects
// they are a member of, and each tool is its own switch under Settings → MCP.
//
// What keeps them safe to call from an agent:
// - Each one is idempotent by name: a second call with the same name returns what the first one
//   created instead of a duplicate, because MCP clients retry and agents repeat themselves.
// - Each one has a per-user daily cap (DAILY_LIMITS). A runaway agent can create a handful of
//   objects, not hundreds.
// - Nothing here can grant more than the app's own settings screens can: assistant tools come from
//   the same Tools Access keys (ASSISTANT_TOOL_KEYS, pinned to toolOptions.js by a parity test) and
//   models from SELECTABLE_ASSISTANT_MODELS.
// ---------------------------------------------------------------------------

const MCP_WORKSPACE_SETUP_TOOLS = [
    'create_project',
    'add_contact_statuses',
    'create_assistant',
    'update_assistant',
    'create_assistant_task',
    'get_assistant_tasks',
    'update_assistant_task',
]

// Mirrors TOOL_OPTIONS / OPT_IN_ONLY_TOOLS in
// components/AssistantDetailedView/Customizations/ToolsAccess/toolOptions.js. Functions code cannot
// import app code, so __tests__/MCP/mcpWorkspaceSetupToolKeysParity.test.js keeps the two in step.
const ASSISTANT_TOOL_KEYS = [
    'create_task',
    'create_note',
    'update_task',
    'update_note',
    'artifacts',
    'update_contact',
    'delete_contact',
    'delete_artifact',
    'create_goal',
    'update_goal',
    'update_milestone',
    'create_okr',
    'update_okr',
    'add_chat_comment',
    'correct_email_classification',
    'update_user_memory',
    'update_heartbeat_settings',
    'update_project_description',
    'update_user_description',
    'update_assistant_settings',
    'compact_thread_context',
    'get_tasks',
    'get_updates',
    'get_goals',
    'get_project_okrs',
    'get_project_happiness',
    'get_chats',
    'get_contacts',
    'get_focus_task',
    'get_user_projects',
    'search',
    'search_gmail',
    'list_recent_chat_media',
    'get_chat_attachment',
    'get_gmail_attachment',
    'create_gmail_reply_draft',
    'create_gmail_draft',
    'update_gmail_draft',
    'update_gmail_email',
    'find_calendar_availability',
    'search_calendar_events',
    'create_calendar_event',
    'update_calendar_event',
    'delete_calendar_event',
    'get_notes',
    'web_search',
    'fetch_url',
    'browser_automation',
    'find_profile_photo',
    'get_route_info',
    'get_local_recommendations',
    'get_weather',
    'execute_task_in_vm',
    'external_tools',
    'mcp_servers',
    'talk_to_assistant',
]
const OPT_IN_ONLY_ASSISTANT_TOOL_KEYS = ['mcp_servers', 'browser_automation', 'delete_contact', 'delete_artifact']
const DEFAULT_ASSISTANT_TOOL_KEYS = ASSISTANT_TOOL_KEYS.filter(key => !OPT_IN_ONLY_ASSISTANT_TOOL_KEYS.includes(key))

// The app's project marker colours (Themes/Modern/ProjectColors.js → Themes/Colors.js).
const PROJECT_COLORS = [
    '#47A3FF',
    '#47DEFF',
    '#FF5274',
    '#CB70FF',
    '#00F477',
    '#FF70B3',
    '#FF925C',
    '#F0E219',
    '#0AFFBE',
    '#BFFF0A',
    '#7C70FF',
]
const PROJECT_COLOR_DEFAULT = PROJECT_COLORS[0]

const PROJECT_PUBLIC = 0
const DEFAULT_WORKSTREAM_ID = 'ws@default'
const ESTIMATION_TYPE_TIME = 'TIME'
const DEFAULT_MODEL = 'MODEL_GPT6_SOL'
const DEFAULT_EMAIL_SIGNATURE = '---\nAnna Alldone\nAI Chief of Staff\nhttps://alldone.app/'
const DEFAULT_HEARTBEAT_PROMPT =
    'Check the done tasks today, comment on it and/or the chat history with one sentence and ask the user if he already did the focus task (remind him) or if there are any other ways you can help.'
const TASK_TYPE_PROMPT = 'prompt'
const TASK_EXECUTION_MODE_DIRECT = 'direct'

const RECURRENCE_VALUES = [
    'once',
    'daily',
    'everyWorkday',
    'weekly',
    'every2Weeks',
    'every3Weeks',
    'monthly',
    'every3Months',
    'every6Months',
    'annually',
]
const CUSTOM_RECURRENCE_PATTERN = /^custom:[1-9]\d{0,3}$/

const MAX_PROJECT_NAME_LENGTH = 100
const MAX_DESCRIPTION_LENGTH = 2000
const MAX_INSTRUCTIONS_LENGTH = 20000
const MAX_PROMPT_LENGTH = 20000
const MAX_STATUS_NAME_LENGTH = 60
const MAX_CONTACT_STATUSES_PER_CALL = 20
const MAX_FOLLOW_UP_DAYS = 365

const DAILY_LIMITS = {
    create_project: 5,
    create_assistant: 10,
    update_assistant: 50,
    create_assistant_task: 30,
    update_assistant_task: 50,
}
const QUOTA_DOC = 'mcpWorkspaceSetupQuota'

const contactStatusSchema = {
    type: 'object',
    properties: {
        name: { type: 'string', description: 'Status name, e.g. "reached out".' },
        color: {
            type: 'string',
            description: `Optional colour, one of ${PROJECT_COLORS.join(', ')}. Omitted: colours are assigned in turn.`,
        },
        followUpDays: {
            type: 'integer',
            description: 'Optional: create a follow-up task this many days after a contact enters the status (1–365).',
        },
    },
    required: ['name'],
}

const MCP_WORKSPACE_SETUP_TOOL_SCHEMAS = [
    {
        name: 'create_project',
        description:
            'Create a new Alldone project for the signed-in user, who becomes its only member. Optionally give it contact statuses (a contact pipeline, e.g. "new idea", "reached out", "in conversation"). If the user already has a project with exactly this name, that project is returned instead of creating a duplicate, and any missing contact statuses are added to it. Returns the projectId.',
        inputSchema: {
            type: 'object',
            properties: {
                name: { type: 'string', description: 'Project name.' },
                description: {
                    type: 'string',
                    description:
                        'Optional short, stable project description: what the project is, what belongs in it, standing rules. Assistants use it for routing and framing.',
                },
                color: {
                    type: 'string',
                    description: `Optional project colour, one of ${PROJECT_COLORS.join(', ')}.`,
                },
                contactStatuses: {
                    type: 'array',
                    description: 'Optional contact statuses, in pipeline order.',
                    items: contactStatusSchema,
                },
            },
            required: ['name'],
        },
    },
    {
        name: 'add_contact_statuses',
        description:
            "Add contact statuses (pipeline stages) to a project the user is a member of. Statuses whose name already exists in the project are left as they are. Returns the project's statuses with their IDs, which update_contact accepts as contactStatusId.",
        inputSchema: {
            type: 'object',
            properties: {
                projectId: { type: 'string', description: 'The project (see get_user_projects).' },
                statuses: { type: 'array', description: 'Statuses to add, in order.', items: contactStatusSchema },
            },
            required: ['projectId', 'statuses'],
        },
    },
    {
        name: 'create_assistant',
        description:
            'Create an AI assistant in a project the user is a member of. If the project already has an assistant with exactly this name, that assistant is returned instead. Returns the assistantId, which create_assistant_task needs.',
        inputSchema: {
            type: 'object',
            properties: {
                projectId: { type: 'string', description: 'The project (see get_user_projects).' },
                name: { type: 'string', description: 'Assistant name, e.g. "Growth Lead".' },
                description: { type: 'string', description: 'Optional one-line description shown in the app.' },
                instructions: {
                    type: 'string',
                    description: "The assistant's instructions (its system prompt): role, goals, rules, tone.",
                },
                model: {
                    type: 'string',
                    description: `Optional model key, one of ${SELECTABLE_ASSISTANT_MODELS.map(m => m.model).join(
                        ', '
                    )}. Default ${DEFAULT_MODEL}.`,
                },
                allowedTools: {
                    type: 'array',
                    items: { type: 'string' },
                    description: `Optional Tools Access keys the assistant may use. Omitted: the app's defaults (everything except ${OPT_IN_ONLY_ASSISTANT_TOOL_KEYS.join(
                        ' and '
                    )}). Valid keys: ${ASSISTANT_TOOL_KEYS.join(', ')}.`,
                },
            },
            required: ['projectId', 'name', 'instructions'],
        },
    },
    {
        name: 'update_assistant',
        description:
            "Change an existing AI assistant in a project the user is a member of: its name, description, instructions, model or Tools Access. Only the fields you pass change. For tools, either pass allowedTools (the complete new list) or addTools/removeTools (changes to the current list), not both. Changed instructions also reach the assistant's scheduled tasks that still use an unchanged copy of the old instructions; tasks with instructions of their own keep them. Returns what changed and the resulting tool list.",
        inputSchema: {
            type: 'object',
            properties: {
                projectId: { type: 'string', description: 'The project the assistant belongs to.' },
                assistantId: { type: 'string', description: 'The assistant (from create_assistant or the app).' },
                name: { type: 'string', description: 'Optional new name.' },
                description: {
                    type: 'string',
                    description: 'Optional new one-line description. Empty string clears it.',
                },
                instructions: {
                    type: 'string',
                    description: "Optional new instructions (the assistant's system prompt).",
                },
                model: {
                    type: 'string',
                    description: `Optional new model key, one of ${SELECTABLE_ASSISTANT_MODELS.map(m => m.model).join(
                        ', '
                    )}.`,
                },
                allowedTools: {
                    type: 'array',
                    items: { type: 'string' },
                    description: `Optional complete new list of Tools Access keys. Valid keys: ${ASSISTANT_TOOL_KEYS.join(
                        ', '
                    )}.`,
                },
                addTools: {
                    type: 'array',
                    items: { type: 'string' },
                    description: 'Optional Tools Access keys to switch on, e.g. ["artifacts"].',
                },
                removeTools: {
                    type: 'array',
                    items: { type: 'string' },
                    description: 'Optional Tools Access keys to switch off.',
                },
            },
            required: ['projectId', 'assistantId'],
        },
    },
    {
        name: 'create_assistant_task',
        description:
            "Create a pre-configured assistant task that the assistant runs on a schedule for the signed-in user (e.g. a daily research run or a weekly review). Each run creates a task assigned to the assistant with the user as observer, and the assistant's answer is posted in that task's thread. Runs cost Gold like any assistant run. If the assistant already has a task with exactly this name, that task is returned instead. Returns the taskId and the first run time.",
        inputSchema: {
            type: 'object',
            properties: {
                projectId: { type: 'string', description: 'The project the assistant belongs to.' },
                assistantId: { type: 'string', description: 'The assistant (from create_assistant).' },
                name: { type: 'string', description: 'Task name, e.g. "Weekly growth review".' },
                prompt: { type: 'string', description: 'What the assistant should do on every run.' },
                recurrence: {
                    type: 'string',
                    description: `How often it runs: ${RECURRENCE_VALUES.join(
                        ', '
                    )}, or custom:<days> (e.g. custom:3).`,
                },
                startDate: {
                    type: 'string',
                    description: "Optional first run date as YYYY-MM-DD in the user's timezone. Default today.",
                },
                startTime: {
                    type: 'string',
                    description: "Optional run time as HH:mm (24h) in the user's timezone. Default 08:00.",
                },
                sendWhatsApp: {
                    type: 'boolean',
                    description: 'Optional: also send each result to the user on WhatsApp. Default false.',
                },
            },
            required: ['projectId', 'assistantId', 'name', 'prompt', 'recurrence'],
        },
    },
    {
        name: 'get_assistant_tasks',
        description:
            "List an assistant's scheduled tasks: name, the full prompt, how often and when it runs for the signed-in user, whether it is active for them, and when it last ran. Use it to find a taskId and to read the current prompt before update_assistant_task.",
        inputSchema: {
            type: 'object',
            properties: {
                projectId: { type: 'string', description: 'The project the assistant belongs to.' },
                assistantId: { type: 'string', description: 'The assistant.' },
            },
            required: ['projectId', 'assistantId'],
        },
    },
    {
        name: 'update_assistant_task',
        description:
            "Change a scheduled assistant task: its prompt, its name, how often or when it runs, whether results also go to WhatsApp, or pause and resume it for the signed-in user. Find the task by taskId (from get_assistant_tasks) or taskName. Only the fields you pass change; a call that changes nothing writes nothing. The start date anchors the rhythm (a weekly task runs on that date's weekday), so changing only startTime keeps the existing start date.",
        inputSchema: {
            type: 'object',
            properties: {
                projectId: { type: 'string', description: 'The project the assistant belongs to.' },
                assistantId: { type: 'string', description: 'The assistant.' },
                taskId: { type: 'string', description: 'The task (from get_assistant_tasks).' },
                taskName: { type: 'string', description: 'Alternative to taskId: the exact task name.' },
                name: { type: 'string', description: 'New task name.' },
                prompt: { type: 'string', description: 'New complete prompt; replaces the old one.' },
                recurrence: {
                    type: 'string',
                    description: `New rhythm: ${RECURRENCE_VALUES.join(', ')}, or custom:<days>.`,
                },
                startDate: {
                    type: 'string',
                    description: "New start date as YYYY-MM-DD in the user's timezone.",
                },
                startTime: {
                    type: 'string',
                    description: "New run time as HH:mm (24h) in the user's timezone.",
                },
                sendWhatsApp: {
                    type: 'boolean',
                    description: 'Also send each result to the user on WhatsApp.',
                },
                active: {
                    type: 'boolean',
                    description: 'false pauses the task for the signed-in user, true resumes it.',
                },
            },
            required: ['projectId', 'assistantId'],
        },
    },
]

class WorkspaceSetupError extends Error {}

const fail = message => {
    throw new WorkspaceSetupError(message)
}

const cleanString = (value, fieldName, { required = false, maxLength } = {}) => {
    if (value === undefined || value === null) {
        if (required) fail(`${fieldName} is required.`)
        return ''
    }
    if (typeof value !== 'string') fail(`${fieldName} must be a string.`)
    const trimmed = value.trim()
    if (required && !trimmed) fail(`${fieldName} must not be empty.`)
    if (maxLength && trimmed.length > maxLength) fail(`${fieldName} must be at most ${maxLength} characters.`)
    return trimmed
}

const sameName = (a, b) =>
    typeof a === 'string' && typeof b === 'string' && a.trim().toLowerCase() === b.trim().toLowerCase()

const getDb = deps => (deps && deps.db) || admin.firestore()
const getNow = deps => (deps && typeof deps.now === 'function' ? deps.now() : Date.now())
const newId = db => db.collection('projects').doc().id

async function consumeDailyQuota(db, userId, toolName, now) {
    const limit = DAILY_LIMITS[toolName]
    if (!limit) return
    const day = moment.utc(now).format('YYYY-MM-DD')
    const ref = db.doc(`users/${userId}/private/${QUOTA_DOC}`)
    await db.runTransaction(async transaction => {
        const snapshot = await transaction.get(ref)
        const data = snapshot.exists ? snapshot.data() || {} : {}
        const counts = data.day === day && data.counts && typeof data.counts === 'object' ? data.counts : {}
        const used = Number(counts[toolName]) || 0
        if (used >= limit) {
            fail(
                `${toolName} is limited to ${limit} calls per day over MCP, and today's limit is reached. Do it in the Alldone app or try again tomorrow.`
            )
        }
        transaction.set(ref, { day, counts: { ...counts, [toolName]: used + 1 } })
    })
}

async function getProjectForMember(db, userId, projectId) {
    const id = cleanString(projectId, 'projectId', { required: true })
    const snapshot = await db.doc(`projects/${id}`).get()
    const project = snapshot.exists ? snapshot.data() || {} : null
    if (!project || !Array.isArray(project.userIds) || !project.userIds.includes(userId)) {
        fail(`Project not found or not accessible: "${id}". get_user_projects lists your projects.`)
    }
    return { id, project }
}

async function getUserData(db, userId) {
    const snapshot = await db.doc(`users/${userId}`).get()
    return snapshot.exists ? snapshot.data() || {} : {}
}

function resolveUserTimezone(userData) {
    const iana = typeof userData.preferredTimezone === 'string' ? userData.preferredTimezone.trim() : ''
    if (iana && moment.tz.zone(iana)) return { iana, offsetMinutes: null }
    const raw =
        userData.timezone ?? userData.timezoneOffset ?? userData.timezoneMinutes ?? userData.preferredTimezone ?? null
    const offsetMinutes = TaskRetrievalService.normalizeTimezoneOffset(raw)
    return { iana: null, offsetMinutes: typeof offsetMinutes === 'number' ? offsetMinutes : 0 }
}

function normalizeContactStatuses(statuses, existingStatuses = {}) {
    if (statuses === undefined || statuses === null) return []
    if (!Array.isArray(statuses)) fail('contactStatuses must be an array.')
    if (statuses.length > MAX_CONTACT_STATUSES_PER_CALL) {
        fail(`At most ${MAX_CONTACT_STATUSES_PER_CALL} contact statuses per call.`)
    }
    const existingNames = Object.values(existingStatuses || {}).map(status => status && status.name)
    const seen = []
    const result = []
    statuses.forEach((status, index) => {
        if (!status || typeof status !== 'object') fail(`contactStatuses[${index}] must be an object.`)
        const name = cleanString(status.name, `contactStatuses[${index}].name`, {
            required: true,
            maxLength: MAX_STATUS_NAME_LENGTH,
        })
        if (existingNames.some(existing => sameName(existing, name)) || seen.some(other => sameName(other, name))) {
            return
        }
        seen.push(name)
        let color = PROJECT_COLORS[(existingNames.length + result.length + 1) % PROJECT_COLORS.length]
        if (status.color !== undefined && status.color !== null && status.color !== '') {
            const wanted = String(status.color).trim().toUpperCase()
            const match = PROJECT_COLORS.find(candidate => candidate === wanted)
            if (!match) fail(`contactStatuses[${index}].color must be one of ${PROJECT_COLORS.join(', ')}.`)
            color = match
        }
        let followUpDays = null
        if (status.followUpDays !== undefined && status.followUpDays !== null) {
            const days = Number(status.followUpDays)
            if (!Number.isInteger(days) || days < 1 || days > MAX_FOLLOW_UP_DAYS) {
                fail(`contactStatuses[${index}].followUpDays must be a whole number from 1 to ${MAX_FOLLOW_UP_DAYS}.`)
            }
            followUpDays = days
        }
        result.push({ name, color, followUpDays })
    })
    return result
}

function buildContactStatusEntries(db, statuses) {
    const base = generateSortIndex()
    return statuses.map((status, index) => ({
        id: newId(db),
        name: status.name,
        color: status.color,
        sortIndex: base + index,
        followUpDays: status.followUpDays,
    }))
}

const listStatuses = contactStatuses =>
    Object.values(contactStatuses || {})
        .filter(Boolean)
        .sort((a, b) => (a.sortIndex || 0) - (b.sortIndex || 0))
        .map(status => ({ id: status.id, name: status.name, followUpDays: status.followUpDays ?? null }))

async function findUserProjectByName(db, userData, name) {
    const projectIds = Array.isArray(userData.projectIds) ? userData.projectIds.filter(Boolean) : []
    if (projectIds.length === 0) return null
    const snapshots = await db.getAll(...projectIds.map(id => db.doc(`projects/${id}`)))
    for (const snapshot of snapshots) {
        if (!snapshot.exists) continue
        const project = snapshot.data() || {}
        if (project.isTemplate || project.parentTemplateId) continue
        if (sameName(project.name, name)) return { id: snapshot.id, project }
    }
    return null
}

function buildProjectDocument({ userId, name, description, color, timezone, now, contactStatusEntries, actor }) {
    const contactStatuses = {}
    contactStatusEntries.forEach(entry => {
        contactStatuses[entry.id] = entry
    })
    return {
        color,
        created: now,
        creatorId: userId,
        name,
        description,
        projectStartDate: now,
        userIds: [userId],
        isPrivate: true,
        isShared: PROJECT_PUBLIC,
        estimationType: ESTIMATION_TYPE_TIME,
        lastActionDate: now,
        monthlyXp: 0,
        monthlyTraffic: 0,
        isTemplate: false,
        templateCreatorId: '',
        guideProjectIds: [],
        parentTemplateId: '',
        activeFullSearch: null,
        hourlyRatesData: { currency: 'EUR', hourlyRates: {} },
        dayRateTimeLog: {
            enabled: false,
            targetMinutes: 480,
            triggerTasks: 5,
            backfilledUntilByUser: {},
            backfillVersionByUser: {},
        },
        lastChatActionDate: moment(now).subtract(30, 'year').valueOf(),
        usersData: {},
        workstreamIds: [DEFAULT_WORKSTREAM_ID],
        globalAssistantIds: [],
        lastLoggedUserDate: now,
        active: true,
        assistantId: '',
        autoEstimation: true,
        goalMilestonesConfig: normalizeGoalMilestonesConfig({ timezone, cadenceStartDate: now }, timezone, now),
        sortIndexByUser: { [userId]: generateSortIndex() },
        gitlabRepoUrl: '',
        gitlabBaseBranch: '',
        gitlabHost: '',
        githubRepoUrl: '',
        githubBaseBranch: '',
        githubHost: '',
        githubApiBase: '',
        contactStatuses,
        createdVia: actor,
    }
}

function buildMainWorkstream(projectId, userId, now) {
    const lastVisitBoard = { [projectId]: { [userId]: now } }
    return {
        displayName: 'Team',
        description: 'Default workstream to gather general project tasks',
        projectId,
        lastVisitBoard,
        lastVisitBoardInGoals: lastVisitBoard,
        userIds: [userId],
        created: now,
        creatorId: userId,
        lastEditionDate: now,
        lastEditorId: userId,
        photoURL: DEFAULT_WORKSTREAM_ID,
    }
}

async function createProject(userId, args = {}, context = {}, deps = {}) {
    const db = getDb(deps)
    const now = getNow(deps)
    const name = cleanString(args.name, 'name', { required: true, maxLength: MAX_PROJECT_NAME_LENGTH })
    const description = cleanString(args.description, 'description', { maxLength: MAX_DESCRIPTION_LENGTH })
    let color = PROJECT_COLOR_DEFAULT
    if (args.color !== undefined && args.color !== null && args.color !== '') {
        const wanted = String(args.color).trim().toUpperCase()
        color =
            PROJECT_COLORS.find(candidate => candidate === wanted) ||
            fail(`color must be one of ${PROJECT_COLORS.join(', ')}.`)
    }

    const userData = await getUserData(db, userId)
    const existing = await findUserProjectByName(db, userData, name)
    if (existing) {
        const statuses = normalizeContactStatuses(args.contactStatuses, existing.project.contactStatuses)
        const entries = buildContactStatusEntries(db, statuses)
        if (entries.length > 0) {
            const update = {}
            entries.forEach(entry => {
                update[`contactStatuses.${entry.id}`] = entry
            })
            await db.doc(`projects/${existing.id}`).update(update)
        }
        const merged = { ...(existing.project.contactStatuses || {}) }
        entries.forEach(entry => {
            merged[entry.id] = entry
        })
        return {
            projectId: existing.id,
            name: existing.project.name,
            alreadyExisted: true,
            contactStatuses: listStatuses(merged),
            message: `You already have a project named "${existing.project.name}"; it was reused instead of creating a duplicate.`,
        }
    }

    const statuses = normalizeContactStatuses(args.contactStatuses)
    await consumeDailyQuota(db, userId, 'create_project', now)

    const { iana } = resolveUserTimezone(userData)
    const timezone = iana || 'UTC'
    const projectId = newId(db)
    const contactStatusEntries = buildContactStatusEntries(db, statuses)
    const project = buildProjectDocument({
        userId,
        name,
        description,
        color,
        timezone,
        now,
        contactStatusEntries,
        actor: buildMcpActorMarker(context.mcpClient),
    })

    const batch = db.batch()
    batch.set(db.doc(`projects/${projectId}`), project)
    batch.update(db.doc(`users/${userId}`), {
        projectIds: FieldValue.arrayUnion(projectId),
        lastEditionDate: now,
        lastEditorId: userId,
    })
    batch.set(
        db.doc(`projectsWorkstreams/${projectId}/workstreams/${DEFAULT_WORKSTREAM_ID}`),
        buildMainWorkstream(projectId, userId, now)
    )
    await batch.commit()

    return {
        projectId,
        name,
        alreadyExisted: false,
        contactStatuses: listStatuses(project.contactStatuses),
        url: context.baseUrl ? `${context.baseUrl}/projects/${projectId}/user/${userId}/tasks/open` : undefined,
    }
}

async function addContactStatuses(userId, args = {}, context = {}, deps = {}) {
    const db = getDb(deps)
    const { id: projectId } = await getProjectForMember(db, userId, args.projectId)
    if (!Array.isArray(args.statuses) || args.statuses.length === 0) fail('statuses must be a non-empty array.')

    const ref = db.doc(`projects/${projectId}`)
    return await db.runTransaction(async transaction => {
        const snapshot = await transaction.get(ref)
        const project = snapshot.data() || {}
        const statuses = normalizeContactStatuses(args.statuses, project.contactStatuses)
        const entries = buildContactStatusEntries(db, statuses)
        const merged = { ...(project.contactStatuses || {}) }
        if (entries.length > 0) {
            const update = {}
            entries.forEach(entry => {
                update[`contactStatuses.${entry.id}`] = entry
                merged[entry.id] = entry
            })
            transaction.update(ref, update)
        }
        return {
            projectId,
            added: entries.map(entry => entry.name),
            contactStatuses: listStatuses(merged),
        }
    })
}

function normalizeModel(value) {
    if (value === undefined || value === null || value === '') return DEFAULT_MODEL
    const key = normalizeSelectableAssistantModelKey(String(value).trim())
    if (!SELECTABLE_ASSISTANT_MODELS.some(option => option.model === key)) {
        fail(`model must be one of ${SELECTABLE_ASSISTANT_MODELS.map(option => option.model).join(', ')}.`)
    }
    return key
}

function normalizeAllowedTools(value) {
    if (value === undefined || value === null) return [...DEFAULT_ASSISTANT_TOOL_KEYS]
    if (!Array.isArray(value)) fail('allowedTools must be an array of Tools Access keys.')
    const keys = [...new Set(value.map(key => String(key).trim()).filter(Boolean))]
    const unknown = keys.filter(key => !ASSISTANT_TOOL_KEYS.includes(key))
    if (unknown.length > 0) {
        fail(`Unknown Tools Access keys: ${unknown.join(', ')}. Valid keys: ${ASSISTANT_TOOL_KEYS.join(', ')}.`)
    }
    return keys
}

function validateToolKeys(value, fieldName) {
    if (value === undefined || value === null) return null
    if (!Array.isArray(value)) fail(`${fieldName} must be an array of Tools Access keys.`)
    const keys = [...new Set(value.map(key => String(key).trim()).filter(Boolean))]
    const unknown = keys.filter(key => !ASSISTANT_TOOL_KEYS.includes(key))
    if (unknown.length > 0) {
        fail(`Unknown Tools Access keys: ${unknown.join(', ')}. Valid keys: ${ASSISTANT_TOOL_KEYS.join(', ')}.`)
    }
    return keys
}

function buildAssistantDocument({ userId, name, description, instructions, model, allowedTools, now, actor }) {
    return {
        displayName: name,
        lastEditorId: userId,
        lastEditionDate: now,
        creatorId: userId,
        createdDate: now,
        photoURL: '',
        photoURL50: '',
        photoURL300: '',
        description,
        prompt: '',
        thirdPartLink: '',
        type: 'TYPE_PROMPT_BASED',
        instructions,
        model,
        heartbeatModel: model,
        reasoningEffort: null,
        temperature: 'TEMPERATURE_NORMAL',
        realtimeVoice: 'marin',
        emailSignature: DEFAULT_EMAIL_SIGNATURE,
        allowedTools,
        enabledSkillIds: [],
        delegationToolDescriptionManual: '',
        delegationToolDescriptionGenerated: '',
        delegationToolDescriptionGeneratedAt: null,
        delegationToolDescriptionInputHash: '',
        lastVisitBoard: {},
        fromTemplate: false,
        isDefault: false,
        noteIdsByProject: {},
        commentsData: null,
        heartbeatAwakeStart: 28800000,
        heartbeatAwakeEnd: 79200000,
        heartbeatIntervalMs: 1800000,
        heartbeatChancePercent: 0,
        heartbeatChanceNoReplyPercent: 0,
        heartbeatSendWhatsApp: false,
        heartbeatPrompt: DEFAULT_HEARTBEAT_PROMPT,
        createdVia: actor,
    }
}

async function createAssistant(userId, args = {}, context = {}, deps = {}) {
    const db = getDb(deps)
    const now = getNow(deps)
    const { id: projectId } = await getProjectForMember(db, userId, args.projectId)
    const name = cleanString(args.name, 'name', { required: true, maxLength: MAX_PROJECT_NAME_LENGTH })
    const description = cleanString(args.description, 'description', { maxLength: MAX_DESCRIPTION_LENGTH })
    const instructions = cleanString(args.instructions, 'instructions', {
        required: true,
        maxLength: MAX_INSTRUCTIONS_LENGTH,
    })
    const model = normalizeModel(args.model)
    const allowedTools = normalizeAllowedTools(args.allowedTools)

    const existingSnapshot = await db.collection(`assistants/${projectId}/items`).get()
    const existing = existingSnapshot.docs.find(doc => sameName((doc.data() || {}).displayName, name))
    if (existing) {
        const data = existing.data() || {}
        return {
            assistantId: existing.id,
            projectId,
            name: data.displayName,
            alreadyExisted: true,
            message: `This project already has an assistant named "${data.displayName}"; it was reused and left unchanged.`,
        }
    }

    await consumeDailyQuota(db, userId, 'create_assistant', now)

    const assistantId = newId(db)
    await db.doc(`assistants/${projectId}/items/${assistantId}`).set(
        buildAssistantDocument({
            userId,
            name,
            description,
            instructions,
            model,
            allowedTools,
            now,
            actor: buildMcpActorMarker(context.mcpClient),
        })
    )

    return { assistantId, projectId, name, model, allowedTools, alreadyExisted: false }
}

const sameToolSet = (a, b) => a.length === b.length && a.every(key => b.includes(key))

// The new tool list. Entries that are not Tools Access keys (written by older versions of the app)
// are kept as they are: a caller cannot see or manage them, so it must not drop them by accident.
function resolveUpdatedTools(current, { allowedTools, addTools, removeTools }) {
    const currentTools = Array.isArray(current.allowedTools) ? current.allowedTools : [...DEFAULT_ASSISTANT_TOOL_KEYS]
    if (allowedTools) {
        return currentTools.filter(key => !ASSISTANT_TOOL_KEYS.includes(key)).concat(allowedTools)
    }
    if (addTools || removeTools) {
        const removed = new Set(removeTools || [])
        return [...new Set([...currentTools, ...(addTools || [])])].filter(key => !removed.has(key))
    }
    return currentTools
}

async function updateAssistant(userId, args = {}, context = {}, deps = {}) {
    const db = getDb(deps)
    const now = getNow(deps)
    const { id: projectId } = await getProjectForMember(db, userId, args.projectId)
    const assistantId = cleanString(args.assistantId, 'assistantId', { required: true })
    if (assistantId.includes('/')) fail('assistantId is not valid.')

    const allowedTools = validateToolKeys(args.allowedTools, 'allowedTools')
    const addTools = validateToolKeys(args.addTools, 'addTools')
    const removeTools = validateToolKeys(args.removeTools, 'removeTools')
    if (allowedTools && (addTools || removeTools)) {
        fail('Pass either allowedTools (the complete list) or addTools/removeTools, not both.')
    }
    const conflicting = (addTools || []).filter(key => (removeTools || []).includes(key))
    if (conflicting.length > 0) fail(`A key cannot be added and removed at once: ${conflicting.join(', ')}.`)

    const fields = ['name', 'description', 'instructions', 'model']
    if (!fields.some(field => args[field] !== undefined) && !allowedTools && !addTools && !removeTools) {
        fail('Pass at least one of name, description, instructions, model, allowedTools, addTools or removeTools.')
    }

    const ref = db.doc(`assistants/${projectId}/items/${assistantId}`)
    const snapshot = await ref.get()
    if (!snapshot.exists) fail(`Assistant not found in this project: "${assistantId}".`)
    const current = snapshot.data() || {}

    const update = {}
    const changed = []
    if (args.name !== undefined) {
        const name = cleanString(args.name, 'name', { required: true, maxLength: MAX_PROJECT_NAME_LENGTH })
        if (name !== current.displayName) {
            update.displayName = name
            changed.push('name')
        }
    }
    if (args.description !== undefined) {
        const description = cleanString(args.description, 'description', { maxLength: MAX_DESCRIPTION_LENGTH })
        if (description !== (current.description || '')) {
            update.description = description
            changed.push('description')
        }
    }
    if (args.instructions !== undefined) {
        const instructions = cleanString(args.instructions, 'instructions', {
            required: true,
            maxLength: MAX_INSTRUCTIONS_LENGTH,
        })
        if (instructions !== current.instructions) {
            update.instructions = instructions
            changed.push('instructions')
        }
    }
    if (args.model !== undefined) {
        if (args.model === null || args.model === '') fail('model must not be empty.')
        const model = normalizeModel(args.model)
        if (model !== current.model) {
            update.model = model
            changed.push('model')
        }
    }
    const currentTools = Array.isArray(current.allowedTools) ? current.allowedTools : [...DEFAULT_ASSISTANT_TOOL_KEYS]
    if (allowedTools || addTools || removeTools) {
        const nextTools = resolveUpdatedTools(current, { allowedTools, addTools, removeTools })
        if (!sameToolSet(nextTools, currentTools)) {
            update.allowedTools = nextTools
            changed.push('allowedTools')
        }
    }

    const result = {
        assistantId,
        projectId,
        name: update.displayName || current.displayName || '',
        model: update.model || current.model || DEFAULT_MODEL,
        allowedTools: update.allowedTools || currentTools,
        changed,
        toolsAdded: (update.allowedTools || currentTools).filter(key => !currentTools.includes(key)),
        toolsRemoved: currentTools.filter(key => !(update.allowedTools || currentTools).includes(key)),
        tasksWithUpdatedInstructions: 0,
    }
    if (changed.length === 0) {
        return { ...result, message: 'Nothing changed: the assistant already has these settings.' }
    }

    await consumeDailyQuota(db, userId, 'update_assistant', now)

    const actor = buildMcpActorMarker(context.mcpClient)
    update.lastEditorId = userId
    update.lastEditionDate = now
    update.lastEditorVia = buildLastEditorVia(actor, now)

    const batch = db.batch()
    batch.update(ref, update)
    if (update.instructions !== undefined && typeof current.instructions === 'string' && current.instructions) {
        // A scheduled task stores a copy of the instructions it was created with and runs on that
        // copy. A copy nobody changed follows the assistant; one somebody edited is left alone.
        const tasks = await db.collection(`assistantTasks/${projectId}/${assistantId}`).get()
        tasks.docs.forEach(taskDoc => {
            if ((taskDoc.data() || {}).aiSystemMessage === current.instructions) {
                batch.update(taskDoc.ref, { aiSystemMessage: update.instructions })
                result.tasksWithUpdatedInstructions += 1
            }
        })
    }
    await batch.commit()

    return result
}

function normalizeRecurrence(value) {
    const recurrence = cleanString(value, 'recurrence', { required: true })
    if (RECURRENCE_VALUES.includes(recurrence) || CUSTOM_RECURRENCE_PATTERN.test(recurrence)) return recurrence
    fail(`recurrence must be one of ${RECURRENCE_VALUES.join(', ')} or custom:<days>.`)
}

// The start of the schedule exactly as the app's own form stores it: startDate is the UTC instant of
// the local start, startTime the local HH:mm and userTimezone the offset the form was filled in, so
// functions/Assistant/timezoneResolver.js reconstructs the same local time for every later run.
function buildSchedule({ startDate, startTime, userData, now }) {
    const time = startTime === undefined || startTime === null || startTime === '' ? '08:00' : String(startTime).trim()
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) fail('startTime must be HH:mm (24h), e.g. 08:00.')

    const { iana, offsetMinutes } = resolveUserTimezone(userData)
    const nowLocal = iana ? moment.tz(now, iana) : moment.utc(now).utcOffset(offsetMinutes)
    let date = nowLocal.format('YYYY-MM-DD')
    if (startDate !== undefined && startDate !== null && startDate !== '') {
        date = String(startDate).trim()
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !moment(date, 'YYYY-MM-DD', true).isValid()) {
            fail('startDate must be YYYY-MM-DD.')
        }
    }

    const localStart = iana
        ? moment.tz(`${date} ${time}`, 'YYYY-MM-DD HH:mm', iana)
        : moment.utc(`${date} ${time}`, 'YYYY-MM-DD HH:mm').subtract(offsetMinutes, 'minutes').utcOffset(offsetMinutes)
    const startOffsetMinutes = localStart.utcOffset()

    return {
        startDate: localStart.valueOf(),
        startTime: time,
        userTimezone: startOffsetMinutes % 60 === 0 ? startOffsetMinutes / 60 : startOffsetMinutes,
        firstRunLocal: localStart.format('YYYY-MM-DD HH:mm Z'),
    }
}

async function createAssistantTask(userId, args = {}, context = {}, deps = {}) {
    const db = getDb(deps)
    const now = getNow(deps)
    const { id: projectId } = await getProjectForMember(db, userId, args.projectId)
    const assistantId = cleanString(args.assistantId, 'assistantId', { required: true })
    const assistantSnapshot = await db.doc(`assistants/${projectId}/items/${assistantId}`).get()
    if (!assistantSnapshot.exists) {
        fail(
            `Assistant "${assistantId}" was not found in project "${projectId}". Only assistants created in the project are supported here, not global assistants.`
        )
    }
    const assistant = assistantSnapshot.data() || {}
    const name = cleanString(args.name, 'name', { required: true, maxLength: MAX_PROJECT_NAME_LENGTH })
    const prompt = cleanString(args.prompt, 'prompt', { required: true, maxLength: MAX_PROMPT_LENGTH })
    const recurrence = normalizeRecurrence(args.recurrence)
    if (args.sendWhatsApp !== undefined && typeof args.sendWhatsApp !== 'boolean') {
        fail('sendWhatsApp must be true or false.')
    }

    const collection = db.collection(`assistantTasks/${projectId}/${assistantId}`)
    const existingSnapshot = await collection.get()
    const existing = existingSnapshot.docs.find(doc => sameName((doc.data() || {}).name, name))
    if (existing) {
        return {
            taskId: existing.id,
            assistantId,
            projectId,
            name: (existing.data() || {}).name,
            alreadyExisted: true,
            message: 'This assistant already has a task with this name; it was reused and left unchanged.',
        }
    }

    const userData = await getUserData(db, userId)
    const schedule = buildSchedule({ startDate: args.startDate, startTime: args.startTime, userData, now })

    await consumeDailyQuota(db, userId, 'create_assistant_task', now)

    const taskId = newId(db)
    const task = {
        id: taskId,
        name,
        type: TASK_TYPE_PROMPT,
        prompt,
        variables: [],
        link: '',
        aiSystemMessage: assistant.instructions || '',
        recurrence,
        executionMode: TASK_EXECUTION_MODE_DIRECT,
        startDate: schedule.startDate,
        startTime: schedule.startTime,
        userTimezone: schedule.userTimezone,
        creatorUserId: userId,
        activatorUserId: userId,
        activatedUserIds: [userId],
        activatedInProjectId: projectId,
        recurrenceByUser: { [userId]: recurrence },
        sendWhatsApp: args.sendWhatsApp === true,
        assistantId,
        order: existingSnapshot.size,
        lastExecuted: null,
        createdVia: buildMcpActorMarker(context.mcpClient),
    }
    // The user asked for this task through their own MCP client, so its content is approved for
    // them (security audit 2026-11, NEW-A: a scheduled run executes only approved content).
    task[APPROVED_CONTENT_HASH_FIELD] = { [userId]: computeAssistantTaskContentHash(task) }

    const batch = db.batch()
    batch.set(collection.doc(taskId), task)
    batch.update(db.doc(`assistants/${projectId}/items/${assistantId}`), {
        lastEditionDate: now,
        lastEditorId: userId,
    })
    await batch.commit()

    return {
        taskId,
        assistantId,
        projectId,
        name,
        recurrence,
        firstRun: schedule.firstRunLocal,
        alreadyExisted: false,
    }
}

async function getProjectAssistant(db, userId, args) {
    const { id: projectId } = await getProjectForMember(db, userId, args.projectId)
    const assistantId = cleanString(args.assistantId, 'assistantId', { required: true })
    const assistantSnapshot = await db.doc(`assistants/${projectId}/items/${assistantId}`).get()
    if (!assistantSnapshot.exists) fail(`Assistant "${assistantId}" was not found in project "${projectId}".`)
    return { projectId, assistantId }
}

// The local date a stored schedule starts on, in the user's timezone: what the app's form shows.
function getLocalStartDate(task, userData) {
    if (!(Number(task.startDate) > 0)) return undefined
    const { iana, offsetMinutes } = resolveUserTimezone(userData)
    return iana
        ? moment.tz(Number(task.startDate), iana).format('YYYY-MM-DD')
        : moment.utc(Number(task.startDate)).utcOffset(offsetMinutes).format('YYYY-MM-DD')
}

const getActiveUserIds = task => (Array.isArray(task.activatedUserIds) ? task.activatedUserIds : [])

function summarizeAssistantTask(task, userId, userData) {
    const activeUserIds = getActiveUserIds(task)
    return {
        taskId: task.id,
        name: task.name || '',
        type: task.type || TASK_TYPE_PROMPT,
        prompt: task.prompt || '',
        recurrence: (task.recurrenceByUser && task.recurrenceByUser[userId]) || task.recurrence || 'never',
        startDate: getLocalStartDate(task, userData) || null,
        startTime: task.startTime || null,
        active: activeUserIds.includes(userId),
        activeForUserCount: activeUserIds.length,
        sendWhatsApp: task.sendWhatsApp === true,
        // Not Number.isFinite(Number(x)): Number(null) is 0, which would report a task that never ran as run in 1970.
        lastRun: Number(task.lastExecuted) > 0 ? new Date(Number(task.lastExecuted)).toISOString() : null,
    }
}

async function getAssistantTasks(userId, args = {}, context = {}, deps = {}) {
    const db = getDb(deps)
    const { projectId, assistantId } = await getProjectAssistant(db, userId, args)
    const userData = await getUserData(db, userId)
    const snapshot = await db.collection(`assistantTasks/${projectId}/${assistantId}`).get()
    const tasks = snapshot.docs
        .map(doc => ({ ...(doc.data() || {}), id: doc.id }))
        .sort((a, b) => (Number(a.order) || 0) - (Number(b.order) || 0))
        .map(task => summarizeAssistantTask(task, userId, userData))
    return { projectId, assistantId, count: tasks.length, tasks }
}

async function updateAssistantTask(userId, args = {}, context = {}, deps = {}) {
    const db = getDb(deps)
    const now = getNow(deps)
    const { projectId, assistantId } = await getProjectAssistant(db, userId, args)
    const collection = db.collection(`assistantTasks/${projectId}/${assistantId}`)
    const snapshot = await collection.get()
    const tasks = snapshot.docs.map(doc => ({ ...(doc.data() || {}), id: doc.id }))

    const taskId = cleanString(args.taskId, 'taskId')
    const taskName = cleanString(args.taskName, 'taskName')
    if (!taskId && !taskName) fail('taskId or taskName is required. Use get_assistant_tasks to find it.')
    const task = taskId ? tasks.find(item => item.id === taskId) : tasks.find(item => sameName(item.name, taskName))
    if (!task) fail(`No scheduled task ${taskId ? `"${taskId}"` : `named "${taskName}"`} for this assistant.`)

    const userData = await getUserData(db, userId)
    const update = {}
    const changes = []

    if (args.name !== undefined) {
        const name = cleanString(args.name, 'name', { required: true, maxLength: MAX_PROJECT_NAME_LENGTH })
        if (name !== task.name) {
            if (tasks.some(item => item.id !== task.id && sameName(item.name, name))) {
                fail(`This assistant already has a task named "${name}".`)
            }
            update.name = name
            changes.push('name')
        }
    }
    if (args.prompt !== undefined) {
        const prompt = cleanString(args.prompt, 'prompt', { required: true, maxLength: MAX_PROMPT_LENGTH })
        if (prompt !== task.prompt) {
            update.prompt = prompt
            changes.push('prompt')
        }
    }
    if (args.sendWhatsApp !== undefined) {
        if (typeof args.sendWhatsApp !== 'boolean') fail('sendWhatsApp must be true or false.')
        if (args.sendWhatsApp !== (task.sendWhatsApp === true)) {
            update.sendWhatsApp = args.sendWhatsApp
            changes.push(args.sendWhatsApp ? 'WhatsApp on' : 'WhatsApp off')
        }
    }

    // The rhythm is stored per user (recurrenceByUser) next to the task's default; both follow the
    // caller, as when the app's form is saved.
    const currentRecurrence = (task.recurrenceByUser && task.recurrenceByUser[userId]) || task.recurrence
    let recurrence = currentRecurrence
    if (args.recurrence !== undefined) {
        recurrence = normalizeRecurrence(args.recurrence)
        if (recurrence !== currentRecurrence) changes.push('recurrence')
    }

    const changesStart =
        (args.startDate !== undefined && args.startDate !== null && args.startDate !== '') ||
        (args.startTime !== undefined && args.startTime !== null && args.startTime !== '')
    if (changesStart) {
        const schedule = buildSchedule({
            startDate: args.startDate || getLocalStartDate(task, userData),
            startTime: args.startTime || task.startTime,
            userData,
            now,
        })
        if (schedule.startDate !== Number(task.startDate) || schedule.startTime !== task.startTime) {
            update.startDate = schedule.startDate
            update.startTime = schedule.startTime
            update.userTimezone = schedule.userTimezone
            changes.push('schedule')
        }
    }

    const activeUserIds = getActiveUserIds(task)
    let active = activeUserIds.includes(userId)
    if (args.active !== undefined) {
        if (typeof args.active !== 'boolean') fail('active must be true or false.')
        if (args.active !== active) {
            active = args.active
            changes.push(active ? 'resumed' : 'paused')
        }
    }

    if (changes.includes('recurrence') || changes.includes('resumed') || changes.includes('paused')) {
        const recurrenceByUser = { ...(task.recurrenceByUser || {}) }
        if (active) {
            recurrenceByUser[userId] = recurrence
            update.activatedUserIds = activeUserIds.includes(userId) ? activeUserIds : [...activeUserIds, userId]
            if (!task.activatorUserId || changes.includes('resumed')) update.activatorUserId = userId
            if (!task.activatedInProjectId) update.activatedInProjectId = projectId
        } else {
            delete recurrenceByUser[userId]
            update.activatedUserIds = activeUserIds.filter(id => id !== userId)
        }
        update.recurrenceByUser = recurrenceByUser
        if (changes.includes('recurrence')) update.recurrence = recurrence
    }

    if (changes.length === 0) {
        return {
            projectId,
            assistantId,
            changed: [],
            message: 'The task already had these values; nothing was written.',
            task: summarizeAssistantTask(task, userId, userData),
        }
    }

    await consumeDailyQuota(db, userId, 'update_assistant_task', now)
    update.lastEditionDate = now
    update.lastEditorId = userId
    update.lastEditedVia = buildMcpActorMarker(context.mcpClient)

    const batch = db.batch()
    batch.update(collection.doc(task.id), update)
    batch.update(db.doc(`assistants/${projectId}/items/${assistantId}`), { lastEditionDate: now, lastEditorId: userId })
    await batch.commit()

    const updatedTask = { ...task, ...update }
    return {
        projectId,
        assistantId,
        changed: changes,
        task: summarizeAssistantTask(updatedTask, userId, userData),
        ...(changesStart && update.startDate ? { firstRun: moment(update.startDate).toISOString() } : {}),
    }
}

const HANDLERS = {
    create_project: createProject,
    add_contact_statuses: addContactStatuses,
    create_assistant: createAssistant,
    update_assistant: updateAssistant,
    create_assistant_task: createAssistantTask,
    get_assistant_tasks: getAssistantTasks,
    update_assistant_task: updateAssistantTask,
}

async function executeWorkspaceSetupTool(toolName, userId, args, context = {}, deps = {}) {
    const handler = HANDLERS[toolName]
    if (!handler) throw new Error(`Unknown workspace setup tool: ${toolName}`)
    if (!userId) throw new Error('Authentication required.')
    return await handler(userId, args && typeof args === 'object' ? args : {}, context, deps)
}

module.exports = {
    MCP_WORKSPACE_SETUP_TOOLS,
    MCP_WORKSPACE_SETUP_TOOL_SCHEMAS,
    ASSISTANT_TOOL_KEYS,
    OPT_IN_ONLY_ASSISTANT_TOOL_KEYS,
    DEFAULT_ASSISTANT_TOOL_KEYS,
    PROJECT_COLORS,
    DAILY_LIMITS,
    WorkspaceSetupError,
    executeWorkspaceSetupTool,
    buildSchedule,
    normalizeContactStatuses,
    // joinProjectSecondGen builds a template's new guide from the same defaults.
    buildProjectDocument,
}
