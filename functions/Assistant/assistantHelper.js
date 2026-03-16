const { v4: uuidv4 } = require('uuid')
const admin = require('firebase-admin')
const crypto = require('crypto')
const moment = require('moment')
const OpenAI = require('openai')
const { Tiktoken } = require('@dqbd/tiktoken/lite')
const cl100k_base = require('@dqbd/tiktoken/encoders/cl100k_base.json')

const {
    MENTION_SPACE_CODE,
    STAYWARD_COMMENT,
    FEED_PUBLIC_FOR_ALL,
    ASSISTANT_LAST_COMMENT_ALL_PROJECTS_KEY,
    inProductionEnvironment,
    OPEN_STEP,
} = require('../Utils/HelperFunctionsCloud')
const { logEvent } = require('../GAnalytics/GAnalytics')
const {
    GLOBAL_PROJECT_ID,
    getDefaultAssistantData,
    updateAssistantLastCommentData,
} = require('../Firestore/assistantsFirestore')
const { updateContactLastCommentData } = require('../Firestore/contactsFirestore')
const { updateUserLastCommentData } = require('../Users/usersFirestore')
const { updateSkillLastCommentData } = require('../Skills/skillsFirestore')
const { updateTaskLastCommentData } = require('../Tasks/tasksFirestoreCloud')
const { updateGoalLastCommentData } = require('../Goals/goalsFirestore')
const { updateNoteLastCommentData } = require('../Notes/notesFirestoreCloud')
const {
    removeFormatTagsFromText,
    cleanTextMetaData,
    shrinkTagText,
    LAST_COMMENT_CHARACTER_LIMIT_IN_BIG_SCREEN,
    getImageData,
} = require('../Utils/parseTextUtils')
const { getObjectFollowersIds } = require('../Feeds/globalFeedsHelper')
const { getProject } = require('../Firestore/generalFirestoreCloud')
const { getChat } = require('../Chats/chatsFirestoreCloud')
const { BatchWrapper } = require('../BatchWrapper/batchWrapper')
const { getEnvFunctions } = require('../envFunctionsHelper')
const { ENABLE_DETAILED_LOGGING } = require('./performanceConfig')
const { getToolSchemasCacheContextVersion } = require('./toolSchemaCacheVersion')
const { getUserMemoryContextMessage, updateUserMemory } = require('./userMemoryHelper')

const MODEL_GPT3_5 = 'MODEL_GPT3_5'
const MODEL_GPT4 = 'MODEL_GPT4'
const MODEL_GPT4O = 'MODEL_GPT4O'
const MODEL_GPT5 = 'MODEL_GPT5' // Deprecated, maps to MODEL_GPT5_1
const MODEL_GPT5_1 = 'MODEL_GPT5_1'
const MODEL_GPT5_4 = 'MODEL_GPT5_4'
const MODEL_GPT5_2 = 'MODEL_GPT5_2'
const MODEL_SONAR = 'MODEL_SONAR'
const MODEL_SONAR_PRO = 'MODEL_SONAR_PRO'
const MODEL_SONAR_REASONING = 'MODEL_SONAR_REASONING'
const MODEL_SONAR_REASONING_PRO = 'MODEL_SONAR_REASONING_PRO'
const MODEL_SONAR_DEEP_RESEARCH = 'MODEL_SONAR_DEEP_RESEARCH'

const TEMPERATURE_VERY_LOW = 'TEMPERATURE_VERY_LOW'
const TEMPERATURE_LOW = 'TEMPERATURE_LOW'
const TEMPERATURE_NORMAL = 'TEMPERATURE_NORMAL'
const TEMPERATURE_HIGH = 'TEMPERATURE_HIGH'
const TEMPERATURE_VERY_HIGH = 'TEMPERATURE_VERY_HIGH'

const COMPLETION_MAX_TOKENS = 1000
const COMPLETION_MAX_TOKENS_GPT5_1 = 2000 // GPT-5.1 needs more tokens due to stricter limits
const COMPLETION_MAX_TOKENS_GPT5_4 = 2000 // GPT-5.4 needs more tokens due to stricter limits
const COMPLETION_MAX_TOKENS_GPT5_2 = 2000 // GPT-5.2 needs more tokens due to stricter limits

const ENCODE_MESSAGE_GAP = 4
const CHARACTERS_PER_TOKEN_SONAR = 4 // Approximate number of characters per token for Sonar models
const IMAGE_TRIGGER = 'O2TI5plHBf1QfdY'
const REGEX_IMAGE_TOKEN = /^O2TI5plHBf1QfdY[\S]+O2TI5plHBf1QfdY[\S]+O2TI5plHBf1QfdY[\S]+O2TI5plHBf1QfdY[\S]+/
const TALK_TO_ASSISTANT_TOOL_KEY = 'talk_to_assistant'
const TALK_TO_ASSISTANT_TOOL_PREFIX = 'talk_to_assistant_'
const ALLOWED_DELEGATION_TARGET_KEYS_FIELD = 'allowedDelegationTargetKeys'
const EXTERNAL_TOOLS_KEY = 'external_tools'
const EXTERNAL_TOOL_PREFIX = 'external_tool_'
const MAX_TALK_TO_ASSISTANT_TARGETS = 50
const MAX_EXTERNAL_INTEGRATION_TOOLS = 40
const MAX_ASSISTANT_DELEGATION_DEPTH = 2
const MAX_NATIVE_TOOL_CALL_ITERATIONS = 10
const TOOL_PROGRESS_UPDATE_INTERVAL_MS = 7000
const GMAIL_LABEL_FOLLOW_UP_TASK_ORIGIN = 'gmail_label_follow_up'

// Service instance caches for reuse across tool executions (performance optimization)
// Similar pattern to MCP server for consistency
let cachedNoteService = null
let cachedSearchService = null
let cachedTaskService = null

// Cache environment variables at module level (performance optimization)
let cachedEnvFunctions = null
let envLoadTime = 0

function getCachedEnvFunctions() {
    const now = Date.now()
    // Cache for 5 minutes
    if (!cachedEnvFunctions || now - envLoadTime > 300000) {
        cachedEnvFunctions = getEnvFunctions()
        envLoadTime = now
    }
    return cachedEnvFunctions
}

function buildGmailTaskDataFromRuntimeContext(toolRuntimeContext = null, targetProjectId = '') {
    const gmailContext = toolRuntimeContext?.gmailContext
    if (!gmailContext || gmailContext.origin !== GMAIL_LABEL_FOLLOW_UP_TASK_ORIGIN) return null

    const messageId = typeof gmailContext.messageId === 'string' ? gmailContext.messageId.trim() : ''
    if (!messageId) return null

    return {
        origin: GMAIL_LABEL_FOLLOW_UP_TASK_ORIGIN,
        gmailEmail: typeof gmailContext.gmailEmail === 'string' ? gmailContext.gmailEmail.trim().toLowerCase() : '',
        projectId: targetProjectId || gmailContext.projectId || '',
        messageId,
        threadId: typeof gmailContext.threadId === 'string' ? gmailContext.threadId.trim() : '',
        webUrl: typeof gmailContext.webUrl === 'string' ? gmailContext.webUrl.trim() : '',
        archiveOnComplete: gmailContext.archiveOnComplete !== false,
        archiveStatus: null,
    }
}

function sanitizeGmailFollowUpTaskName(name, gmailTaskData = null) {
    const trimmedName = typeof name === 'string' ? name.trim() : ''
    if (!trimmedName || !gmailTaskData?.webUrl) return trimmedName

    let sanitizedName = trimmedName.replace(gmailTaskData.webUrl, ' ')
    sanitizedName = sanitizedName.replace(/^(email|e-mail|mail)\s+/i, '')
    sanitizedName = sanitizedName.replace(/^[:\-|]+\s*/i, '')
    sanitizedName = sanitizedName.replace(/\s+[:\-|]\s+/g, ': ')
    sanitizedName = sanitizedName.replace(/\s+/g, ' ').trim()

    return sanitizedName || trimmedName
}

// Cache OpenAI clients (performance optimization)
const openAIClients = new Map()
const externalToolUserIdentityCache = new Map()
const EXTERNAL_TOOL_USER_IDENTITY_CACHE_TTL = 5 * 60 * 1000
const delegationCapabilitiesCache = new Map()
const DELEGATION_CAPABILITIES_CACHE_TTL = 5 * 60 * 1000
const MAX_DELEGATION_CAPABILITY_EXAMPLES = 5
const preConfiguredTasksContextCache = new Map()
const PRECONFIGURED_TASKS_CONTEXT_CACHE_TTL = 5 * 60 * 1000
const MAX_PRECONFIGURED_TASK_CONTEXT_ITEMS = 20
const dynamicToolSchemasCache = new Map()
const DYNAMIC_TOOL_SCHEMAS_CACHE_TTL = 5 * 60 * 1000
const DYNAMIC_TOOL_SCHEMAS_CACHE_MAX_ENTRIES = 200
const DYNAMIC_TOOL_SCHEMAS_PERSISTED_CACHE_TTL = 30 * 24 * 60 * 60 * 1000
const DYNAMIC_TOOL_SCHEMAS_PERSISTED_CACHE_COLLECTION = 'runtimeCaches/dynamicToolSchemas/items'

function getOpenAIClient(apiKey) {
    if (!openAIClients.has(apiKey)) {
        openAIClients.set(apiKey, new OpenAI({ apiKey }))
    }
    return openAIClients.get(apiKey)
}

async function getExternalToolUserIdentity(userId) {
    const normalizedUserId = typeof userId === 'string' ? userId.trim() : ''
    if (!normalizedUserId) {
        return { userId: '', email: '', notificationEmail: '' }
    }

    const now = Date.now()
    const cached = externalToolUserIdentityCache.get(normalizedUserId)
    if (cached && now - cached.timestamp < EXTERNAL_TOOL_USER_IDENTITY_CACHE_TTL) {
        return cached.data
    }

    let email = ''
    let notificationEmail = ''
    try {
        const userDoc = await admin.firestore().doc(`users/${normalizedUserId}`).get()
        if (userDoc.exists) {
            const userData = userDoc.data() || {}
            if (typeof userData.email === 'string' && userData.email.trim()) {
                email = userData.email.trim().toLowerCase()
            }
            if (typeof userData.notificationEmail === 'string' && userData.notificationEmail.trim()) {
                notificationEmail = userData.notificationEmail.trim().toLowerCase()
            }
        }
    } catch (error) {
        console.warn('⚠️ EXTERNAL TOOL: Failed loading user identity', {
            userId: normalizedUserId,
            error: error.message,
        })
    }

    const identity = {
        userId: normalizedUserId,
        email,
        notificationEmail,
    }

    externalToolUserIdentityCache.set(normalizedUserId, {
        timestamp: now,
        data: identity,
    })

    if (externalToolUserIdentityCache.size > 1000) {
        const oldestKey = externalToolUserIdentityCache.keys().next().value
        externalToolUserIdentityCache.delete(oldestKey)
    }

    return identity
}

/**
 * Check if a model supports native OpenAI tool/function calling
 * @param {string} modelKey - The model key (e.g., MODEL_GPT4O)
 * @returns {boolean} True if model supports native tool calling
 */
const modelSupportsNativeTools = modelKey => {
    // Only GPT models support native tool calling
    return (
        modelKey === MODEL_GPT3_5 ||
        modelKey === MODEL_GPT4 ||
        modelKey === MODEL_GPT4O ||
        modelKey === MODEL_GPT5_1 ||
        modelKey === MODEL_GPT5_4 ||
        modelKey === MODEL_GPT5_2
    )
}

/**
 * Check if a model supports custom temperature values
 * @param {string} modelKey - The model key (e.g., MODEL_GPT4O)
 * @returns {boolean} True if model supports custom temperature
 */
const modelSupportsCustomTemperature = modelKey => {
    // GPT-5.1 and some newer models only support default temperature (1.0)
    if (modelKey === MODEL_GPT5_1 || modelKey === MODEL_GPT5_4 || modelKey === MODEL_GPT5_2) return false
    return true
}

const getTokensPerGold = modelKey => {
    if (modelKey === MODEL_GPT3_5) return 100
    if (modelKey === MODEL_GPT4) return 100
    if (modelKey === MODEL_GPT4O) return 100
    if (modelKey === MODEL_GPT5_1) return 100
    if (modelKey === MODEL_GPT5_4) return 100
    if (modelKey === MODEL_GPT5_2) return 100
    if (modelKey === MODEL_SONAR) return 100
    if (modelKey === MODEL_SONAR_PRO) return 50
    if (modelKey === MODEL_SONAR_REASONING) return 20
    if (modelKey === MODEL_SONAR_REASONING_PRO) return 15
    if (modelKey === MODEL_SONAR_DEEP_RESEARCH) return 10
}

const getMaxTokensForModel = modelKey => {
    // Legacy/Low context models
    if (modelKey === MODEL_GPT3_5) return 16000
    if (modelKey === MODEL_GPT4) return 8000

    // Modern High context models
    if (modelKey === MODEL_GPT4O) return 128000
    if (modelKey === MODEL_GPT5_1) return 128000
    if (modelKey === MODEL_GPT5_4) return 128000
    if (modelKey === MODEL_GPT5_2) return 128000

    // Perplexity/Sonar models (generally high context)
    if (modelKey && modelKey.startsWith('MODEL_SONAR')) return 128000

    // Default fallback
    return 128000
}

// Normalize model key for backward compatibility
const normalizeModelKey = modelKey => {
    // Map deprecated MODEL_GPT5 to MODEL_GPT5_1
    if (modelKey === MODEL_GPT5 || modelKey === 'MODEL_GPT5') return MODEL_GPT5_1
    // Default to MODEL_GPT5_4 if no model specified or empty
    if (!modelKey) return MODEL_GPT5_4
    return modelKey
}

const getModel = modelKey => {
    // Normalize the model key first
    const normalizedKey = normalizeModelKey(modelKey)

    if (normalizedKey === MODEL_GPT3_5) return 'gpt-3.5-turbo'
    if (normalizedKey === MODEL_GPT4) return 'gpt-4'
    if (normalizedKey === MODEL_GPT4O) return 'gpt-4o'
    if (normalizedKey === MODEL_GPT5_1) return 'gpt-5.1'
    if (normalizedKey === MODEL_GPT5_4) return 'gpt-5.4'
    if (normalizedKey === MODEL_GPT5_2) return 'gpt-5.2'
    if (normalizedKey === MODEL_SONAR) return 'sonar'
    if (normalizedKey === MODEL_SONAR_PRO) return 'sonar-pro'
    if (normalizedKey === MODEL_SONAR_REASONING) return 'sonar-reasoning'
    if (normalizedKey === MODEL_SONAR_REASONING_PRO) return 'sonar-reasoning-pro'
    if (normalizedKey === MODEL_SONAR_DEEP_RESEARCH) return 'sonar-deep-research'

    // Default fallback to gpt-5.4
    return 'gpt-5.4'
}

const getTemperature = temperatureKey => {
    if (temperatureKey === TEMPERATURE_VERY_LOW) return 0.2
    else if (temperatureKey === TEMPERATURE_LOW) return 0.5
    else if (temperatureKey === TEMPERATURE_NORMAL) return 0.7
    else if (temperatureKey === TEMPERATURE_HIGH) return 1
    return 1.3
}

const normalizeToolNameToken = value => {
    const normalized = String(value || '')
        .toLowerCase()
        .replace(/[^a-z0-9_-]+/g, '_')
        .replace(/^_+|_+$/g, '')
    return normalized || 'assistant'
}

const buildTalkToAssistantToolName = (projectId, assistantId, displayName, projectName = '') => {
    const projectSlug = normalizeToolNameToken(projectName || projectId).slice(0, 14)
    const assistantSlug = normalizeToolNameToken(displayName).slice(0, 18)
    const hash = crypto.createHash('sha1').update(`${projectId}:${assistantId}`).digest('hex').slice(0, 12)
    return `${TALK_TO_ASSISTANT_TOOL_PREFIX}${projectSlug}_${assistantSlug}_${hash}`
}

const isTalkToAssistantToolName = toolName =>
    typeof toolName === 'string' && toolName.startsWith(TALK_TO_ASSISTANT_TOOL_PREFIX)

const isExternalIntegrationToolName = toolName =>
    typeof toolName === 'string' && toolName.startsWith(EXTERNAL_TOOL_PREFIX)

const trimTextForStatus = (value, maxLength = 100) => {
    const normalized = typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : ''
    if (!normalized) return ''
    return normalized.length > maxLength ? `${normalized.slice(0, maxLength)}...` : normalized
}

const buildToolProgressStatusMessage = ({ toolName, toolArgs, toolCallIteration, elapsedMs }) => {
    const elapsedSeconds = Math.max(0, Math.floor((elapsedMs || 0) / 1000))
    const stepLabel = `${toolCallIteration}/${MAX_NATIVE_TOOL_CALL_ITERATIONS}`
    const updateSeconds = Math.floor(TOOL_PROGRESS_UPDATE_INTERVAL_MS / 1000)

    if (isTalkToAssistantToolName(toolName)) {
        const delegatedTaskPreview = trimTextForStatus(toolArgs?.message, 110)
        return [
            '⏳ Delegating to a specialist assistant...',
            'Now: Sharing your request and context with another assistant.',
            'Waiting: The delegated assistant may run its own tools before replying.',
            `Under the hood: ${toolName} (step ${stepLabel})`,
            delegatedTaskPreview ? `Delegated task: "${delegatedTaskPreview}"` : null,
            `Elapsed: ${elapsedSeconds}s (updates every ${updateSeconds}s)`,
        ]
            .filter(Boolean)
            .join('\n')
    }

    if (isExternalIntegrationToolName(toolName)) {
        return [
            '⏳ Running an external tool...',
            'Now: Sending a secure request to an external integration.',
            'Waiting: Network and external processing can take longer than normal chat.',
            `Under the hood: ${toolName} (step ${stepLabel})`,
            `Elapsed: ${elapsedSeconds}s (updates every ${updateSeconds}s)`,
        ].join('\n')
    }

    return [
        `⏳ Executing ${toolName}...`,
        'Now: Running the requested tool with your current chat context.',
        'Waiting: Tool execution may require additional reads/writes before response generation.',
        `Under the hood: ${toolName} (step ${stepLabel})`,
        `Elapsed: ${elapsedSeconds}s (updates every ${updateSeconds}s)`,
    ].join('\n')
}

const buildInitialAssistantRunStatusMessage = () => {
    return [
        '⏳ Starting your request...',
        'Now: Preparing context and selecting the best next action.',
        'Waiting: This can take longer for complex requests before tool execution starts.',
        'Under the hood: Initial analysis',
    ].join('\n')
}

const buildExternalIntegrationToolName = ({ projectId, assistantId, taskId, integrationId, toolKey, toolName }) => {
    const slug = normalizeToolNameToken(`${integrationId || ''}_${toolKey || toolName || 'tool'}`).slice(0, 22)
    const hash = crypto
        .createHash('sha1')
        .update(`${projectId}:${assistantId}:${taskId}:${integrationId}:${toolKey}:${toolName}`)
        .digest('hex')
        .slice(0, 12)
    return `${EXTERNAL_TOOL_PREFIX}${slug}_${hash}`.slice(0, 64)
}

const isObject = value => value && typeof value === 'object' && !Array.isArray(value)

const normalizeExternalToolInputSchema = schema => {
    if (!isObject(schema)) {
        return {
            type: 'object',
            properties: {},
            required: [],
        }
    }

    const normalized = { ...schema }
    if (normalized.type !== 'object') normalized.type = 'object'
    if (!isObject(normalized.properties)) normalized.properties = {}
    if (!Array.isArray(normalized.required)) normalized.required = []
    return normalized
}

function resolveIntegrationOrigin(task, externalIntegration) {
    if (typeof externalIntegration?.origin === 'string' && externalIntegration.origin.trim()) {
        try {
            return new URL(externalIntegration.origin).origin
        } catch (_) {}
    }

    if (typeof task?.link === 'string' && task.link.trim()) {
        try {
            return new URL(task.link).origin
        } catch (_) {}
    }

    return null
}

function resolveToolExecution(externalIntegration, tool, task) {
    const integrationOrigin = resolveIntegrationOrigin(task, externalIntegration)
    if (!integrationOrigin) return null

    const execution = isObject(tool?.execution) ? tool.execution : {}
    const methodRaw = String(execution.method || 'POST').toUpperCase()
    const method = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(methodRaw) ? methodRaw : 'POST'

    let url = null
    if (typeof execution.url === 'string' && execution.url.trim()) {
        try {
            const parsed = new URL(execution.url.trim())
            if (parsed.protocol !== 'https:' || parsed.origin !== integrationOrigin) return null
            url = parsed.toString()
        } catch (_) {
            return null
        }
    } else if (typeof execution.path === 'string' && execution.path.trim()) {
        const cleanPath = execution.path.trim().startsWith('/') ? execution.path.trim() : `/${execution.path.trim()}`
        try {
            const parsed = new URL(integrationOrigin)
            parsed.pathname = cleanPath
            parsed.search = ''
            parsed.hash = ''
            url = parsed.toString()
        } catch (_) {
            return null
        }
    }

    if (!url) return null

    return {
        method,
        url,
        timeoutMs: Math.min(30000, Math.max(1000, Number(execution.timeoutMs) || 10000)),
    }
}

async function getAssistantPreConfigTaskDocs(projectId, assistantId) {
    const db = admin.firestore()
    const queryPromises = []

    if (projectId === GLOBAL_PROJECT_ID) {
        // Global assistants are stored in the canonical preConfigTasks collection.
        // Avoid legacy assistant-id collections here so deleted stale docs cannot leak into prompts.
        queryPromises.push(
            db
                .collection(`assistantTasks/${projectId}/preConfigTasks`)
                .where('assistantId', '==', assistantId)
                .get()
                .catch(() => null)
        )
    } else {
        queryPromises.push(
            db
                .collection(`assistantTasks/${projectId}/${assistantId}`)
                .get()
                .catch(() => null),
            db
                .collection(`assistantTasks/${projectId}/preConfigTasks`)
                .where('assistantId', '==', assistantId)
                .get()
                .catch(() => null)
        )
    }

    // Global assistants can have their pre-config tasks stored under globalProject.
    if (projectId !== GLOBAL_PROJECT_ID) {
        queryPromises.push(
            db
                .collection(`assistantTasks/${GLOBAL_PROJECT_ID}/preConfigTasks`)
                .where('assistantId', '==', assistantId)
                .get()
                .catch(() => null)
        )
    }

    const snapshots = await Promise.all(queryPromises)

    const byTaskId = new Map()

    snapshots.forEach(snapshot => {
        if (!snapshot || !snapshot.docs) return
        snapshot.docs.forEach(doc => {
            if (!doc.exists) return
            const data = doc.data() || {}
            const taskId = data.id || doc.id
            if (!taskId) return
            byTaskId.set(taskId, { ...data, id: taskId })
        })
    })

    return Array.from(byTaskId.values())
}

const normalizeDelegationCapabilityName = name =>
    String(name || '')
        .trim()
        .replace(/\s+/g, ' ')
        .slice(0, 80)

function buildDelegationCapabilitiesSummary(tasks) {
    const seen = new Set()
    const taskNames = []

    ;(Array.isArray(tasks) ? tasks : []).forEach(task => {
        const rawName = normalizeDelegationCapabilityName(task?.name)
        if (!rawName) return
        const dedupeKey = rawName.toLowerCase()
        if (seen.has(dedupeKey)) return
        seen.add(dedupeKey)
        taskNames.push(rawName)
    })

    if (taskNames.length === 0) return ''

    const examples = taskNames
        .slice(0, MAX_DELEGATION_CAPABILITY_EXAMPLES)
        .map(name => `"${name.replace(/"/g, "'")}"`)
        .join(', ')
    const remainingCount = taskNames.length - Math.min(taskNames.length, MAX_DELEGATION_CAPABILITY_EXAMPLES)

    return remainingCount > 0
        ? `Can help with pre-config tasks like ${examples}, and ${remainingCount} more.`
        : `Can help with pre-config tasks like ${examples}.`
}

async function getDelegationCapabilitiesSummary(projectId, assistantId) {
    if (!projectId || !assistantId) return ''

    const cacheKey = `${projectId}:${assistantId}`
    const now = Date.now()
    const cached = delegationCapabilitiesCache.get(cacheKey)
    if (cached && now - cached.timestamp < DELEGATION_CAPABILITIES_CACHE_TTL) {
        return cached.summary
    }

    let summary = ''
    try {
        const tasks = await getAssistantPreConfigTaskDocs(projectId, assistantId)
        summary = buildDelegationCapabilitiesSummary(tasks)
    } catch (error) {
        console.warn('⚠️ DELEGATION: Failed loading capability summary', {
            projectId,
            assistantId,
            error: error.message,
        })
        summary = ''
    }

    delegationCapabilitiesCache.set(cacheKey, {
        summary,
        timestamp: now,
    })

    if (delegationCapabilitiesCache.size > 1000) {
        const oldestKey = delegationCapabilitiesCache.keys().next().value
        delegationCapabilitiesCache.delete(oldestKey)
    }

    return summary
}

const normalizePreConfiguredTaskText = (value, maxLength = 260) =>
    String(value || '')
        .trim()
        .replace(/\s+/g, ' ')
        .slice(0, maxLength)

function buildPreConfiguredTasksContextMessage(tasks) {
    const relevantTasks = []

    ;(Array.isArray(tasks) ? tasks : []).forEach(task => {
        const type = typeof task?.type === 'string' ? task.type.trim() : ''
        if (type !== 'prompt' && type !== 'link' && type !== 'iframe') return

        const name = normalizePreConfiguredTaskText(task?.name || task?.id || 'Unnamed task', 80)
        const id = normalizePreConfiguredTaskText(task?.id || '', 60)

        if (type === 'prompt') {
            const prompt = normalizePreConfiguredTaskText(task?.prompt || '', 260)
            if (!prompt) return
            relevantTasks.push({ type, name, id, executionInstruction: `Prompt: "${prompt}"` })
            return
        }

        const link = normalizePreConfiguredTaskText(task?.link || '', 220)
        if (!link) return
        const linkLabel = type === 'iframe' ? 'Iframe link' : 'External link'
        relevantTasks.push({ type, name, id, executionInstruction: `${linkLabel}: ${link}` })
    })

    if (relevantTasks.length === 0) {
        return {
            message: '',
            includedCount: 0,
            totalCount: 0,
        }
    }

    const includedTasks = relevantTasks.slice(0, MAX_PRECONFIGURED_TASK_CONTEXT_ITEMS)
    const lines = [
        'You have access to these pre-configured tasks (prompt, external link, and iframe types):',
        ...includedTasks.map(
            (task, index) =>
                `${index + 1}. [${task.type}] "${task.name}" (${task.id || 'no-id'}) -> ${task.executionInstruction}`
        ),
    ]

    const hiddenCount = relevantTasks.length - includedTasks.length
    if (hiddenCount > 0) {
        lines.push(`...and ${hiddenCount} additional pre-configured tasks not listed here.`)
    }

    lines.push(
        'When the user asks to execute one of these tasks, follow its stored execution instruction exactly and do not claim completion unless execution actually happened.'
    )
    lines.push(
        'If the user asks for the link to one of these tools (for example an iframe or external link tool), return the exact stored link from the task.'
    )

    return {
        message: lines.join('\n'),
        includedCount: includedTasks.length,
        totalCount: relevantTasks.length,
    }
}

async function getPreConfiguredTasksContextMessage(projectId, assistantId) {
    if (!projectId || !assistantId) {
        return {
            message: '',
            includedCount: 0,
            totalCount: 0,
        }
    }

    const cacheKey = `${projectId}:${assistantId}`
    const now = Date.now()
    const cached = preConfiguredTasksContextCache.get(cacheKey)
    if (cached && now - cached.timestamp < PRECONFIGURED_TASKS_CONTEXT_CACHE_TTL) {
        return cached.data
    }

    let data = {
        message: '',
        includedCount: 0,
        totalCount: 0,
    }
    try {
        const tasks = await getAssistantPreConfigTaskDocs(projectId, assistantId)
        data = buildPreConfiguredTasksContextMessage(tasks)
    } catch (error) {
        console.warn('⚠️ PRECONFIG CONTEXT: Failed loading assistant tasks', {
            projectId,
            assistantId,
            error: error.message,
        })
    }

    preConfiguredTasksContextCache.set(cacheKey, {
        data,
        timestamp: now,
    })
    if (preConfiguredTasksContextCache.size > 1000) {
        const oldestKey = preConfiguredTasksContextCache.keys().next().value
        preConfiguredTasksContextCache.delete(oldestKey)
    }

    return data
}

function messageLikelyRequiresToolExecution(message) {
    const text = String(message || '').toLowerCase()
    if (!text) return false

    // Action-oriented requests should not be marked as successful without an actual tool execution.
    return /\b(add|create|update|delete|save|publish|post|send|book|schedule|submit|append|remove|change|set|sync|upload)\b/.test(
        text
    )
}

async function getReachableExternalIntegrationTools({
    projectId,
    assistantId,
    requestUserId,
    maxTargets = MAX_EXTERNAL_INTEGRATION_TOOLS,
}) {
    if (!projectId || !assistantId || !requestUserId) return []

    const db = admin.firestore()
    const userDoc = await db.doc(`users/${requestUserId}`).get()
    if (!userDoc.exists) return []

    const userData = userDoc.data() || {}
    const accessibleProjectIds = getAccessibleProjectIdsFromUserData(userData)
    if (!accessibleProjectIds.includes(projectId)) return []

    const tasks = await getAssistantPreConfigTaskDocs(projectId, assistantId)
    const targets = []
    const seen = new Set()

    tasks.forEach(task => {
        if (targets.length >= maxTargets) return
        if (task?.type !== 'iframe') return

        const taskMetadata = isObject(task.taskMetadata) ? task.taskMetadata : {}
        const externalIntegration = isObject(taskMetadata.externalIntegration) ? taskMetadata.externalIntegration : {}
        const rawTools = Array.isArray(externalIntegration.tools) ? externalIntegration.tools : []

        rawTools.forEach(rawTool => {
            if (targets.length >= maxTargets) return
            if (!isObject(rawTool)) return

            const key = normalizeToolNameToken(rawTool.key || rawTool.id || rawTool.name || '')
            if (!key) return

            const execution = resolveToolExecution(externalIntegration, rawTool, task)
            if (!execution) return

            const integrationId = normalizeToolNameToken(
                externalIntegration.integrationId || externalIntegration.id || task.id
            )
            const toolName = buildExternalIntegrationToolName({
                projectId,
                assistantId,
                taskId: task.id,
                integrationId,
                toolKey: key,
                toolName: rawTool.name,
            })

            if (seen.has(toolName)) return
            seen.add(toolName)

            const inputSchema = normalizeExternalToolInputSchema(rawTool.inputSchema)
            const integrationName =
                String(externalIntegration.integrationName || externalIntegration.name || integrationId).trim() ||
                integrationId
            const displayName = String(rawTool.name || key).trim() || key
            const description =
                String(rawTool.description || `Execute ${displayName} in ${integrationName}`).trim() ||
                `Execute ${displayName} in ${integrationName}`

            targets.push({
                toolName,
                projectId,
                assistantId,
                taskId: task.id,
                integrationId,
                integrationName,
                toolKey: key,
                displayName,
                description,
                inputSchema,
                execution,
            })
        })
    })

    return targets.slice(0, maxTargets)
}

const buildExternalIntegrationToolSchema = target => ({
    type: 'function',
    function: {
        name: target.toolName,
        description:
            `Use external integration "${target.integrationName}" to execute "${target.displayName}". ` +
            `${target.description}`,
        parameters: target.inputSchema,
    },
})

async function getDynamicExternalToolSchemas(allowedTools, toolRuntimeContext = null) {
    if (!Array.isArray(allowedTools) || !allowedTools.includes(EXTERNAL_TOOLS_KEY)) return []

    const targets = await getReachableExternalIntegrationTools({
        projectId: toolRuntimeContext?.projectId,
        assistantId: toolRuntimeContext?.assistantId,
        requestUserId: toolRuntimeContext?.requestUserId,
    })
    return targets.map(buildExternalIntegrationToolSchema)
}

async function resolveExternalIntegrationToolTargetByName(toolName, toolRuntimeContext = null) {
    if (!isExternalIntegrationToolName(toolName)) return null

    const targets = await getReachableExternalIntegrationTools({
        projectId: toolRuntimeContext?.projectId,
        assistantId: toolRuntimeContext?.assistantId,
        requestUserId: toolRuntimeContext?.requestUserId,
    })
    return targets.find(target => target.toolName === toolName) || null
}

const getAccessibleProjectIdsFromUserData = userData => {
    const allIds = []
    const appendIds = ids => {
        if (!Array.isArray(ids)) return
        ids.forEach(id => {
            if (typeof id === 'string' && id.trim() && !allIds.includes(id.trim())) {
                allIds.push(id.trim())
            }
        })
    }
    appendIds(userData?.projectIds)
    appendIds(userData?.guideProjectIds)
    appendIds(userData?.templateProjectIds)
    appendIds(userData?.archivedProjectIds)
    return allIds
}

const buildDelegationTargetKey = (projectId, assistantId) =>
    `${String(projectId || '').trim()}:${String(assistantId || '').trim()}`

const normalizeDelegationTargetKey = rawKey => String(rawKey || '').trim()

function filterDelegationTargetsByCallerSelection(targets, callerAssistantData) {
    const rawSelection = callerAssistantData?.[ALLOWED_DELEGATION_TARGET_KEYS_FIELD]
    if (!Array.isArray(rawSelection)) return targets

    const allowedKeys = new Set(rawSelection.map(normalizeDelegationTargetKey).filter(Boolean))
    if (allowedKeys.size === 0) return []

    return targets.filter(target => {
        const fullTargetKey = buildDelegationTargetKey(target.projectId, target.assistantId)
        return allowedKeys.has(fullTargetKey) || allowedKeys.has(target.assistantId)
    })
}

async function getReachableDelegationTargets({
    projectId,
    assistantId,
    requestUserId,
    maxTargets = MAX_TALK_TO_ASSISTANT_TARGETS,
}) {
    if (!projectId || !assistantId || !requestUserId) {
        return []
    }

    const db = admin.firestore()
    const userDoc = await db.doc(`users/${requestUserId}`).get()
    if (!userDoc.exists) {
        return []
    }

    const userData = userDoc.data() || {}
    const accessibleProjectIds = getAccessibleProjectIdsFromUserData(userData)
    if (!accessibleProjectIds.includes(projectId)) {
        return []
    }

    const defaultProjectId = userData.defaultProjectId || null
    const [
        callerAssistantDoc,
        callerGlobalAssistantDoc,
        defaultProjectDoc,
        defaultProjectAssistantDoc,
    ] = await db.getAll(
        db.doc(`assistants/${projectId}/items/${assistantId}`),
        db.doc(`assistants/${GLOBAL_PROJECT_ID}/items/${assistantId}`),
        defaultProjectId ? db.doc(`projects/${defaultProjectId}`) : db.doc(`projects/__missing__`),
        defaultProjectId
            ? db.doc(`assistants/${defaultProjectId}/items/${assistantId}`)
            : db.doc(`assistants/__missing__/items/__missing__`)
    )

    let isPrivilegedDefaultProjectAssistant = false

    if (defaultProjectId && defaultProjectDoc.exists) {
        const defaultProjectAssistantId = defaultProjectDoc.data()?.assistantId || null
        const defaultProjectMarksAssistantAsDefault = (defaultProjectAssistantDoc.data() || {}).isDefault === true
        isPrivilegedDefaultProjectAssistant = defaultProjectAssistantId
            ? defaultProjectAssistantId === assistantId
            : defaultProjectMarksAssistantAsDefault
    }

    const callerExistsInCurrentProject = callerAssistantDoc.exists
    const callerExistsInGlobal = callerGlobalAssistantDoc.exists
    const callerAssistantData = callerExistsInCurrentProject
        ? callerAssistantDoc.data() || {}
        : callerExistsInGlobal
        ? callerGlobalAssistantDoc.data() || {}
        : null
    const callerExistsInProjectContext = callerExistsInCurrentProject || callerExistsInGlobal
    if (!callerExistsInProjectContext && !isPrivilegedDefaultProjectAssistant) {
        console.log('🔁 DELEGATION: caller assistant not eligible for delegation scope', {
            callerProjectId: projectId,
            callerAssistantId: assistantId,
            requestUserId,
            callerExistsInCurrentProject,
            callerExistsInGlobal,
            isPrivilegedDefaultProjectAssistant,
            defaultProjectId,
        })
        return []
    }

    const scopedProjectIds = isPrivilegedDefaultProjectAssistant ? accessibleProjectIds : [projectId]
    const projectNames = new Map()
    const targets = []

    for (let i = 0; i < scopedProjectIds.length && targets.length < maxTargets; i++) {
        const targetProjectId = scopedProjectIds[i]

        const [projectDoc, assistantsSnapshot] = await Promise.all([
            db.doc(`projects/${targetProjectId}`).get(),
            db.collection(`assistants/${targetProjectId}/items`).orderBy('lastEditionDate', 'desc').limit(50).get(),
        ])

        const projectName = projectDoc.exists ? projectDoc.data()?.name || targetProjectId : targetProjectId
        projectNames.set(targetProjectId, projectName)

        assistantsSnapshot.docs.forEach(doc => {
            if (targets.length >= maxTargets) return

            const targetAssistantId = doc.id
            if (targetAssistantId === assistantId) return

            const targetAssistant = doc.data() || {}
            targets.push({
                toolName: buildTalkToAssistantToolName(
                    targetProjectId,
                    targetAssistantId,
                    targetAssistant.displayName || targetAssistantId,
                    projectName
                ),
                projectId: targetProjectId,
                projectName: projectNames.get(targetProjectId) || targetProjectId,
                assistantId: targetAssistantId,
                displayName: targetAssistant.displayName || 'Assistant',
                description: targetAssistant.description || '',
                delegationToolDescriptionManual: targetAssistant.delegationToolDescriptionManual || '',
                delegationToolDescriptionGenerated: targetAssistant.delegationToolDescriptionGenerated || '',
            })
        })
    }

    const filteredTargets = filterDelegationTargetsByCallerSelection(targets, callerAssistantData)
    return filteredTargets.slice(0, maxTargets)
}

const buildTalkToAssistantToolSchema = target => ({
    type: 'function',
    function: {
        name: target.toolName,
        description: (() => {
            const manualDescription = String(target.delegationToolDescriptionManual || '')
                .trim()
                .slice(0, 520)
            const generatedDescription = String(target.delegationToolDescriptionGenerated || '')
                .trim()
                .slice(0, 260)
            const assistantDescription = String(target.description || '')
                .trim()
                .slice(0, 180)
            const selectedDescription = manualDescription || generatedDescription || assistantDescription
            const includeCapabilitiesFallback = !manualDescription && !generatedDescription

            if (manualDescription) {
                return manualDescription
            }

            return (
                `Delegate work to assistant "${target.displayName}" in project "${target.projectName}" ` +
                `(project ID: "${target.projectId}"). ` +
                `${selectedDescription ? `Assistant description: ${selectedDescription}. ` : ''}` +
                `${includeCapabilitiesFallback && target.capabilitiesSummary ? `${target.capabilitiesSummary} ` : ''}` +
                'Pass a clear instruction. The assistant will execute with its own enabled tools and return the result.'
            )
        })(),
        parameters: {
            type: 'object',
            properties: {
                message: {
                    type: 'string',
                    description: 'Instruction for the assistant. Include all required context and expected output.',
                },
            },
            required: ['message'],
        },
    },
})

async function getDynamicDelegationToolSchemas(allowedTools, toolRuntimeContext = null) {
    if (!Array.isArray(allowedTools) || !allowedTools.includes(TALK_TO_ASSISTANT_TOOL_KEY)) {
        return []
    }

    const targets = await getReachableDelegationTargets({
        projectId: toolRuntimeContext?.projectId,
        assistantId: toolRuntimeContext?.assistantId,
        requestUserId: toolRuntimeContext?.requestUserId,
    })

    const targetsWithCapabilities = await Promise.all(
        targets.map(async target => ({
            ...target,
            capabilitiesSummary: await getDelegationCapabilitiesSummary(target.projectId, target.assistantId),
        }))
    )

    return targetsWithCapabilities.map(buildTalkToAssistantToolSchema)
}

function buildDynamicToolSchemasCacheKey(allowedTools, toolRuntimeContext = null, contextVersion = 'p0:g0:x0') {
    const normalizedAllowedTools = Array.isArray(allowedTools)
        ? [...allowedTools]
              .map(tool => String(tool || '').trim())
              .filter(Boolean)
              .sort()
        : []
    return JSON.stringify({
        projectId: String(toolRuntimeContext?.projectId || ''),
        assistantId: String(toolRuntimeContext?.assistantId || ''),
        requestUserId: String(toolRuntimeContext?.requestUserId || ''),
        allowedTools: normalizedAllowedTools,
        contextVersion: String(contextVersion || 'p0:g0:x0'),
    })
}

function buildDynamicToolSchemasPersistedCacheDocId(key) {
    return crypto.createHash('sha256').update(key).digest('hex').slice(0, 40)
}

function emitToolSchemasCacheMetric(eventName, contextVersion, details = {}) {
    console.log('📈 METRIC TOOL_SCHEMAS_CACHE', {
        eventName,
        contextVersion: String(contextVersion || 'p0:g0:x0'),
        ...details,
    })
}

function normalizeDynamicToolSchemasCacheData(data) {
    if (!data || !Array.isArray(data.delegationToolSchemas) || !Array.isArray(data.externalToolSchemas)) {
        return null
    }

    return {
        delegationToolSchemas: data.delegationToolSchemas,
        externalToolSchemas: data.externalToolSchemas,
    }
}

async function getDynamicToolSchemasFromPersistedCache(key) {
    const docId = buildDynamicToolSchemasPersistedCacheDocId(key)
    const docRef = admin.firestore().doc(`${DYNAMIC_TOOL_SCHEMAS_PERSISTED_CACHE_COLLECTION}/${docId}`)
    const snapshot = await docRef.get()

    if (!snapshot.exists) return null

    const payload = snapshot.data() || {}
    if (payload.key !== key) return null
    const timestamp = Number(payload.timestamp || 0)
    if (!timestamp || Date.now() - timestamp >= DYNAMIC_TOOL_SCHEMAS_PERSISTED_CACHE_TTL) return null

    return normalizeDynamicToolSchemasCacheData(payload.data)
}

async function writeDynamicToolSchemasToPersistedCache(key, data) {
    const normalizedData = normalizeDynamicToolSchemasCacheData(data)
    if (!normalizedData) return

    const serializableData = JSON.parse(JSON.stringify(normalizedData))
    const docId = buildDynamicToolSchemasPersistedCacheDocId(key)
    const docRef = admin.firestore().doc(`${DYNAMIC_TOOL_SCHEMAS_PERSISTED_CACHE_COLLECTION}/${docId}`)

    await docRef.set({
        key,
        timestamp: Date.now(),
        data: serializableData,
    })
}

function pruneDynamicToolSchemasCacheIfNeeded() {
    while (dynamicToolSchemasCache.size > DYNAMIC_TOOL_SCHEMAS_CACHE_MAX_ENTRIES) {
        const oldestKey = dynamicToolSchemasCache.keys().next().value
        if (!oldestKey) break
        dynamicToolSchemasCache.delete(oldestKey)
    }
}

async function getDynamicToolSchemasWithCache(allowedTools, toolRuntimeContext = null) {
    const contextVersion = await getToolSchemasCacheContextVersion(toolRuntimeContext)
    const key = buildDynamicToolSchemasCacheKey(allowedTools, toolRuntimeContext, contextVersion)
    const now = Date.now()
    const cached = dynamicToolSchemasCache.get(key)

    if (cached && cached.data && now - cached.timestamp < DYNAMIC_TOOL_SCHEMAS_CACHE_TTL) {
        emitToolSchemasCacheMetric('HIT_MEMORY', contextVersion, {
            projectId: toolRuntimeContext?.projectId || null,
            assistantId: toolRuntimeContext?.assistantId || null,
            requestUserId: toolRuntimeContext?.requestUserId || null,
        })
        console.log('🔧 TOOL SCHEMAS CACHE: HIT', {
            keyLength: key.length,
            contextVersion,
            projectId: toolRuntimeContext?.projectId || null,
            assistantId: toolRuntimeContext?.assistantId || null,
            requestUserId: toolRuntimeContext?.requestUserId || null,
            delegationToolSchemasCount: cached.data.delegationToolSchemas.length,
            externalToolSchemasCount: cached.data.externalToolSchemas.length,
        })
        return cached.data
    }

    if (cached && cached.inFlightPromise) {
        emitToolSchemasCacheMetric('HIT_INFLIGHT', contextVersion, {
            projectId: toolRuntimeContext?.projectId || null,
            assistantId: toolRuntimeContext?.assistantId || null,
            requestUserId: toolRuntimeContext?.requestUserId || null,
        })
        console.log('🔧 TOOL SCHEMAS CACHE: WAITING_FOR_INFLIGHT_BUILD', {
            keyLength: key.length,
            contextVersion,
            projectId: toolRuntimeContext?.projectId || null,
            assistantId: toolRuntimeContext?.assistantId || null,
            requestUserId: toolRuntimeContext?.requestUserId || null,
        })
        return cached.inFlightPromise
    }

    try {
        const persisted = await getDynamicToolSchemasFromPersistedCache(key)
        if (persisted) {
            emitToolSchemasCacheMetric('HIT_PERSISTED', contextVersion, {
                projectId: toolRuntimeContext?.projectId || null,
                assistantId: toolRuntimeContext?.assistantId || null,
                requestUserId: toolRuntimeContext?.requestUserId || null,
            })
            dynamicToolSchemasCache.set(key, {
                timestamp: now,
                data: persisted,
                inFlightPromise: null,
            })
            pruneDynamicToolSchemasCacheIfNeeded()
            console.log('🔧 TOOL SCHEMAS CACHE: HIT_PERSISTED', {
                keyLength: key.length,
                contextVersion,
                projectId: toolRuntimeContext?.projectId || null,
                assistantId: toolRuntimeContext?.assistantId || null,
                requestUserId: toolRuntimeContext?.requestUserId || null,
                delegationToolSchemasCount: persisted.delegationToolSchemas.length,
                externalToolSchemasCount: persisted.externalToolSchemas.length,
            })
            return persisted
        }
    } catch (error) {
        console.warn('🔧 TOOL SCHEMAS CACHE: PERSISTED_READ_FAILED', {
            contextVersion,
            projectId: toolRuntimeContext?.projectId || null,
            assistantId: toolRuntimeContext?.assistantId || null,
            requestUserId: toolRuntimeContext?.requestUserId || null,
            error: error.message,
        })
    }

    const buildStart = Date.now()
    emitToolSchemasCacheMetric('MISS_BUILD_START', contextVersion, {
        projectId: toolRuntimeContext?.projectId || null,
        assistantId: toolRuntimeContext?.assistantId || null,
        requestUserId: toolRuntimeContext?.requestUserId || null,
    })
    const inFlightPromise = (async () => {
        const [delegationToolSchemas, externalToolSchemas] = await Promise.all([
            getDynamicDelegationToolSchemas(allowedTools, toolRuntimeContext),
            getDynamicExternalToolSchemas(allowedTools, toolRuntimeContext),
        ])

        const data = { delegationToolSchemas, externalToolSchemas }
        try {
            await writeDynamicToolSchemasToPersistedCache(key, data)
        } catch (error) {
            console.warn('🔧 TOOL SCHEMAS CACHE: PERSISTED_WRITE_FAILED', {
                contextVersion,
                projectId: toolRuntimeContext?.projectId || null,
                assistantId: toolRuntimeContext?.assistantId || null,
                requestUserId: toolRuntimeContext?.requestUserId || null,
                error: error.message,
            })
        }
        dynamicToolSchemasCache.set(key, {
            timestamp: Date.now(),
            data,
            inFlightPromise: null,
        })
        pruneDynamicToolSchemasCacheIfNeeded()

        emitToolSchemasCacheMetric('MISS_BUILT', contextVersion, {
            projectId: toolRuntimeContext?.projectId || null,
            assistantId: toolRuntimeContext?.assistantId || null,
            requestUserId: toolRuntimeContext?.requestUserId || null,
            buildDurationMs: Date.now() - buildStart,
            delegationToolSchemasCount: delegationToolSchemas.length,
            externalToolSchemasCount: externalToolSchemas.length,
        })
        console.log('🔧 TOOL SCHEMAS CACHE: MISS_BUILT', {
            keyLength: key.length,
            contextVersion,
            projectId: toolRuntimeContext?.projectId || null,
            assistantId: toolRuntimeContext?.assistantId || null,
            requestUserId: toolRuntimeContext?.requestUserId || null,
            buildDurationMs: Date.now() - buildStart,
            delegationToolSchemasCount: delegationToolSchemas.length,
            externalToolSchemasCount: externalToolSchemas.length,
            cacheSize: dynamicToolSchemasCache.size,
        })

        return data
    })()

    dynamicToolSchemasCache.set(key, {
        timestamp: now,
        data: null,
        inFlightPromise,
    })

    try {
        return await inFlightPromise
    } catch (error) {
        dynamicToolSchemasCache.delete(key)
        throw error
    }
}

async function resolveDelegationTargetByToolName(toolName, toolRuntimeContext = null) {
    if (!isTalkToAssistantToolName(toolName)) return null

    const targets = await getReachableDelegationTargets({
        projectId: toolRuntimeContext?.projectId,
        assistantId: toolRuntimeContext?.assistantId,
        requestUserId: toolRuntimeContext?.requestUserId,
    })
    const resolvedTarget = targets.find(target => target.toolName === toolName) || null

    console.log('🔁 DELEGATION: resolveDelegationTargetByToolName', {
        toolName,
        callerProjectId: toolRuntimeContext?.projectId || null,
        callerAssistantId: toolRuntimeContext?.assistantId || null,
        requestUserId: toolRuntimeContext?.requestUserId || null,
        reachableTargetsCount: targets.length,
        resolved: !!resolvedTarget,
        resolvedTargetProjectId: resolvedTarget?.projectId || null,
        resolvedTargetAssistantId: resolvedTarget?.assistantId || null,
        resolvedTargetDisplayName: resolvedTarget?.displayName || null,
        reachableTargetsPreview: targets.slice(0, 20).map(target => ({
            toolName: target.toolName,
            projectId: target.projectId,
            assistantId: target.assistantId,
            displayName: target.displayName,
        })),
    })

    return resolvedTarget
}

async function isToolAllowedForExecution(assistantAllowedTools, toolName, toolRuntimeContext = null) {
    if (!Array.isArray(assistantAllowedTools)) return false
    if (assistantAllowedTools.includes(toolName)) {
        return toolName !== TALK_TO_ASSISTANT_TOOL_KEY && toolName !== EXTERNAL_TOOLS_KEY
    }

    const hasDelegationToggle = assistantAllowedTools.includes(TALK_TO_ASSISTANT_TOOL_KEY)
    if (hasDelegationToggle && isTalkToAssistantToolName(toolName)) {
        const target = await resolveDelegationTargetByToolName(toolName, toolRuntimeContext)
        return !!target
    }

    const hasExternalToolsToggle = assistantAllowedTools.includes(EXTERNAL_TOOLS_KEY)
    if (hasExternalToolsToggle && isExternalIntegrationToolName(toolName)) {
        const target = await resolveExternalIntegrationToolTargetByName(toolName, toolRuntimeContext)
        return !!target
    }

    return false
}

async function collectAssistantTextWithToolCalls({
    stream,
    conversationHistory,
    modelKey,
    temperatureKey,
    allowedTools,
    toolRuntimeContext,
    userContext = null,
}) {
    let responseText = ''
    let currentConversation = conversationHistory
    let currentToolCalls = null
    let toolCallIteration = 0
    const executedToolNames = []

    const collectStreamContent = async activeStream => {
        let nextToolCalls = null
        for await (const chunk of activeStream) {
            if (chunk.additional_kwargs?.tool_calls && Array.isArray(chunk.additional_kwargs.tool_calls)) {
                nextToolCalls = chunk.additional_kwargs.tool_calls
            } else if (chunk.content) {
                responseText += chunk.content
            }
        }
        return nextToolCalls
    }

    currentToolCalls = await collectStreamContent(stream)

    while (currentToolCalls && currentToolCalls.length > 0 && toolCallIteration < MAX_NATIVE_TOOL_CALL_ITERATIONS) {
        toolCallIteration++

        const toolCall = currentToolCalls[0]
        const toolName = toolCall?.function?.name
        const toolCallId = toolCall?.id
        let toolArgs = {}

        try {
            toolArgs = JSON.parse(toolCall?.function?.arguments || '{}')
        } catch (error) {
            throw new Error(`Failed to parse tool arguments for ${toolName}`)
        }

        const isAllowed = await isToolAllowedForExecution(allowedTools, toolName, toolRuntimeContext)
        if (!isAllowed) {
            throw new Error(`Tool not permitted: ${toolName}`)
        }

        const toolResult = await executeToolNatively(
            toolName,
            toolArgs,
            toolRuntimeContext?.projectId,
            toolRuntimeContext?.assistantId,
            toolRuntimeContext?.requestUserId,
            userContext,
            toolRuntimeContext
        )
        executedToolNames.push(toolName)

        currentConversation = [
            ...currentConversation,
            {
                role: 'assistant',
                content: responseText,
                tool_calls: [
                    {
                        id: toolCallId,
                        type: 'function',
                        function: {
                            name: toolName,
                            arguments: JSON.stringify(toolArgs),
                        },
                    },
                ],
            },
            {
                role: 'tool',
                content: JSON.stringify(toolResult),
                tool_call_id: toolCallId,
            },
            {
                role: 'user',
                content:
                    'Based on the tool results above, provide your response. If any tool result indicates failure, blocked status, or no execution, do not claim completion. Explain what is missing and what should be tried next. If needed, call additional tools.',
            },
        ]

        const resumedStream = await interactWithChatStream(
            currentConversation,
            modelKey,
            temperatureKey,
            allowedTools,
            toolRuntimeContext
        )
        currentToolCalls = await collectStreamContent(resumedStream)
    }

    if (toolCallIteration >= MAX_NATIVE_TOOL_CALL_ITERATIONS) {
        responseText += '\n\nMaximum tool call iterations reached.'
    }

    return {
        assistantResponse: responseText.trim(),
        executedToolCallsCount: toolCallIteration,
        executedToolNames,
        reachedMaxToolIterations: toolCallIteration >= MAX_NATIVE_TOOL_CALL_ITERATIONS,
    }
}

async function spentGold(userId, goldToReduce) {
    console.log('🔋 GOLD COST TRACKING: Spending gold:', { userId, goldToReduce })

    // Check if FieldValue.increment is available
    if (admin.firestore.FieldValue && admin.firestore.FieldValue.increment) {
        console.log('🔋 GOLD COST TRACKING: Using FieldValue.increment')
        const promises = []
        promises.push(
            admin
                .firestore()
                .doc(`users/${userId}`)
                .update({
                    gold: admin.firestore.FieldValue.increment(-goldToReduce),
                })
        )
        promises.push(logEvent(userId, 'SpentGold', { spentGold: goldToReduce }))
        await Promise.all(promises)
    } else {
        console.log('🔋 GOLD COST TRACKING: FieldValue.increment not available, using manual calculation')
        // Fallback for emulator: get current gold, then update manually
        const userDoc = await admin.firestore().doc(`users/${userId}`).get()
        const currentGold = userDoc.data()?.gold || 0
        const newGold = Math.max(0, currentGold - goldToReduce)

        console.log('🔋 GOLD COST TRACKING: Manual calculation:', { currentGold, goldToReduce, newGold })

        const promises = []
        promises.push(admin.firestore().doc(`users/${userId}`).update({ gold: newGold }))
        promises.push(logEvent(userId, 'SpentGold', { spentGold: goldToReduce }))
        await Promise.all(promises)
    }
}

const reduceGoldWhenChatWithAI = async (
    userId,
    userCurrentGold,
    aiModel,
    aiCommentText,
    contextMessages,
    encoder = null
) => {
    console.log('🔋 GOLD COST TRACKING: Starting gold reduction process:', {
        userId,
        userCurrentGold,
        aiModel,
        modelName: getModel(aiModel),
        tokensPerGold: getTokensPerGold(aiModel),
        textLength: aiCommentText?.length,
        contextMessagesCount: contextMessages?.length,
        hasReusedEncoder: !!encoder,
    })

    const tokens = calculateTokens(aiCommentText, contextMessages, aiModel, encoder)
    console.log('🔋 GOLD COST TRACKING: Token calculation complete:', {
        totalTokens: tokens,
        aiModel,
        tokensPerGold: getTokensPerGold(aiModel),
    })

    const goldToReduce = calculateGoldToReduce(userCurrentGold, tokens, aiModel)
    console.log('🔋 GOLD COST TRACKING: Gold calculation complete:', {
        goldToReduce,
        userCurrentGold,
        costPerToken: 1 / getTokensPerGold(aiModel),
        totalCost: tokens / getTokensPerGold(aiModel),
        cappedAtUserGold: goldToReduce < tokens / getTokensPerGold(aiModel),
    })

    await spentGold(userId, goldToReduce)
    console.log('🔋 GOLD COST TRACKING: Gold reduction completed')
}

const calculateTokens = (aiText, contextMessages, modelKey, encoder = null) => {
    console.log('🧮 TOKEN CALCULATION: Starting for model:', modelKey)

    const aiTextLength = aiText?.length || 0
    const contextMessageDetails = contextMessages.map((msg, index) => ({
        index,
        type: msg[0],
        length: getMessageTextForTokenCounting(msg[1]).length,
    }))

    console.log('🧮 TOKEN CALCULATION: Input details:', {
        modelKey,
        aiTextLength,
        contextMessagesCount: contextMessages.length,
        contextMessageDetails,
        encodeMessageGap: ENCODE_MESSAGE_GAP,
        hasReusedEncoder: !!encoder,
    })

    // For Sonar models, use character count
    if (modelKey && modelKey.startsWith('MODEL_SONAR')) {
        let totalChars = aiTextLength
        let contextChars = 0
        contextMessages.forEach(msg => {
            const msgLength = getMessageTextForTokenCounting(msg[1]).length
            contextChars += msgLength
            totalChars += msgLength
        })
        const baseTokens = Math.ceil(totalChars / CHARACTERS_PER_TOKEN_SONAR)
        const gapTokens = (contextMessages.length + 1) * ENCODE_MESSAGE_GAP
        const tokens = baseTokens + gapTokens

        console.log('🧮 TOKEN CALCULATION: Sonar model result:', {
            totalChars,
            aiTextChars: aiTextLength,
            contextChars,
            charactersPerToken: CHARACTERS_PER_TOKEN_SONAR,
            baseTokens,
            gapTokens,
            totalTokens: tokens,
        })
        return tokens
    }

    // For other models, use token encoding
    // Reuse provided encoder or create a new one
    const encoding = encoder || new Tiktoken(cl100k_base.bpe_ranks, cl100k_base.special_tokens, cl100k_base.pat_str)
    let aiTokens = encoding.encode(aiText).length
    let contextTokens = 0
    let gapTokens = ENCODE_MESSAGE_GAP // Gap for AI response

    contextMessages.forEach((msg, index) => {
        const msgText = getMessageTextForTokenCounting(msg[1])
        const msgTokens = encoding.encode(msgText).length
        contextTokens += msgTokens
        gapTokens += ENCODE_MESSAGE_GAP
        console.log(`🧮 TOKEN CALCULATION: Context message ${index} (${msg[0]}): ${msgTokens} tokens`)
    })

    const totalTokens = aiTokens + contextTokens + gapTokens

    // Only free encoder if we created it (not if it was passed in)
    if (!encoder) {
        encoding.free()
    }

    console.log('🧮 TOKEN CALCULATION: OpenAI model result:', {
        aiTokens,
        contextTokens,
        gapTokens,
        totalTokens,
        breakdown: {
            aiResponse: aiTokens,
            contextMessages: contextTokens,
            encodingGaps: gapTokens,
        },
    })
    return totalTokens
}

const calculateGoldToReduce = (userGold, totalTokens, model) => {
    console.log('Calculating gold Reduction:', {
        userGold,
        totalTokens,
        model,
        tokensPerGold: getTokensPerGold(model),
    })
    const goldCost = calculateGoldCostFromTokens(totalTokens, model)
    const goldToReduce = userGold - goldCost > 0 ? goldCost : userGold
    return goldToReduce
}

const calculateGoldCostFromTokens = (totalTokens, model) => {
    const tokensPerGold = getTokensPerGold(model)
    if (!tokensPerGold || !Number.isFinite(totalTokens)) return 0
    return Math.round(totalTokens / tokensPerGold)
}

async function interactWithChatStream(
    formattedPrompt,
    modelKey,
    temperatureKey,
    allowedTools = [],
    toolRuntimeContext = null
) {
    const streamStartTime = Date.now()
    console.log('🌊 [TIMING] interactWithChatStream START', {
        timestamp: new Date().toISOString(),
        modelKey,
        allowedToolsCount: allowedTools.length,
        promptLength: formattedPrompt?.length,
    })

    // Step 1: Get model config and cached environment
    const configStart = Date.now()
    const model = getModel(modelKey) || 'gpt-5.4' // Fallback to gpt-5.4 if undefined
    const temperature = getTemperature(temperatureKey)
    const envFunctions = getCachedEnvFunctions() // Use cached version
    const configDuration = Date.now() - configStart

    console.log(`📊 [TIMING] Config loading: ${configDuration}ms`, {
        model,
        temperature,
        hasPerplexityKey: !!envFunctions.PERPLEXITY_API_KEY,
        hasOpenAIKey: !!envFunctions.OPEN_AI_KEY,
    })

    const { OPEN_AI_KEY, PERPLEXITY_API_KEY } = envFunctions

    // Check if it's a Perplexity model
    if (modelKey.startsWith('MODEL_SONAR')) {
        console.log('Using Perplexity model')
        const { PerplexityClient } = require('./perplexityClient')
        try {
            console.log('Creating PerplexityClient instance...')
            // Convert messages to Perplexity format [role, content]
            const formattedMessages = Array.isArray(formattedPrompt)
                ? formattedPrompt.map(msg => {
                      // Handle array format [role, content]
                      if (Array.isArray(msg)) {
                          return msg
                      }
                      // Handle object format { role, content }
                      if (typeof msg === 'object' && msg.role && msg.content) {
                          return [msg.role, msg.content]
                      }
                      console.error('Unexpected message format:', JSON.stringify(msg))
                      throw new Error('Unexpected message format')
                  })
                : formattedPrompt
            console.log('Formatted messages:', JSON.stringify(formattedMessages, null, 2))

            const client = new PerplexityClient(PERPLEXITY_API_KEY, model)
            console.log('PerplexityClient created successfully')
            return await client.stream(formattedMessages)
        } catch (error) {
            console.error('Error creating PerplexityClient:', error)
            throw error
        }
    } else {
        // Native OpenAI implementation with tool calling support
        // Use cached OpenAI client (performance optimization)
        const openAIInitStart = Date.now()
        const openai = getOpenAIClient(OPEN_AI_KEY)
        console.log(`📊 [TIMING] OpenAI client (CACHED): ${Date.now() - openAIInitStart}ms`)

        // Convert messages to OpenAI format
        const formatStart = Date.now()
        const getContentLength = content => {
            if (typeof content === 'string') return content.length
            return getMessageTextForTokenCounting(content).length
        }
        const getContentPreview = content => getMessageTextForTokenCounting(content).substring(0, 200)
        const messages = Array.isArray(formattedPrompt)
            ? formattedPrompt.map(msg => {
                  // Handle array format [role, content]
                  if (Array.isArray(msg)) {
                      return { role: msg[0], content: msg[1] }
                  }
                  // Handle object format { role, content, tool_calls?, tool_call_id? }
                  if (typeof msg === 'object' && msg.role) {
                      const result = { role: msg.role, content: msg.content || '' }
                      // Preserve tool_calls for assistant messages
                      if (msg.tool_calls) {
                          result.tool_calls = msg.tool_calls
                      }
                      // Preserve tool_call_id for tool messages
                      if (msg.tool_call_id) {
                          result.tool_call_id = msg.tool_call_id
                      }
                      return result
                  }
                  console.error('Unexpected message format:', JSON.stringify(msg))
                  throw new Error('Unexpected message format')
              })
            : formattedPrompt
        console.log(`📊 [TIMING] Message formatting: ${Date.now() - formatStart}ms`)

        const requestParams = {
            model: model,
            messages: messages,
            stream: true,
        }

        // Let OpenAI manage token limits naturally - don't set max_completion_tokens
        console.log(`Using natural token limits for model ${model}`)

        // Only add temperature if the model supports custom temperature
        // Some models (like gpt-5.1) only support the default temperature (1.0)
        if (modelSupportsCustomTemperature(modelKey)) {
            requestParams.temperature = temperature
        } else {
            console.log(`Model ${model} does not support custom temperature, using default (1.0)`)
        }

        // Add tools if model supports native tools and tools are allowed
        if (modelSupportsNativeTools(modelKey) && Array.isArray(allowedTools) && allowedTools.length > 0) {
            const { getToolSchemas } = require('./toolSchemas')
            const staticAllowedTools = allowedTools.filter(
                toolName => toolName !== TALK_TO_ASSISTANT_TOOL_KEY && toolName !== EXTERNAL_TOOLS_KEY
            )
            const staticToolSchemas = getToolSchemas(staticAllowedTools)
            const dynamicToolSchemasStart = Date.now()
            const { delegationToolSchemas, externalToolSchemas } = await getDynamicToolSchemasWithCache(
                allowedTools,
                toolRuntimeContext
            )
            console.log('🔧 TOOL SCHEMAS: Dynamic schema retrieval complete', {
                retrievalDurationMs: Date.now() - dynamicToolSchemasStart,
                projectId: toolRuntimeContext?.projectId || null,
                assistantId: toolRuntimeContext?.assistantId || null,
                requestUserId: toolRuntimeContext?.requestUserId || null,
            })
            const toolSchemas = [...staticToolSchemas, ...delegationToolSchemas, ...externalToolSchemas]

            console.log('🔧 TOOL SCHEMAS: Assembled for request', {
                staticAllowedToolsCount: staticAllowedTools.length,
                staticToolSchemasCount: staticToolSchemas.length,
                delegationToolSchemasCount: delegationToolSchemas.length,
                externalToolSchemasCount: externalToolSchemas.length,
                externalToolsToggleEnabled: allowedTools.includes(EXTERNAL_TOOLS_KEY),
                toolRuntimeContext,
            })

            if (allowedTools.includes(EXTERNAL_TOOLS_KEY) && externalToolSchemas.length === 0) {
                console.warn('🔧 TOOL SCHEMAS: External tools are enabled but none are reachable at runtime', {
                    projectId: toolRuntimeContext?.projectId,
                    assistantId: toolRuntimeContext?.assistantId,
                    requestUserId: toolRuntimeContext?.requestUserId,
                })
            }

            if (toolSchemas.length > 0) {
                console.log(
                    'Using native tool schemas:',
                    toolSchemas.map(t => t.function.name)
                )
                requestParams.tools = toolSchemas
            }
        }

        console.log('Creating OpenAI stream with params:', {
            model: requestParams.model,
            temperature: requestParams.temperature,
            max_tokens: requestParams.max_tokens,
            messageCount: messages.length,
            hasTools: !!requestParams.tools,
            toolCount: requestParams.tools?.length,
            toolNames: requestParams.tools?.map(t => t.function.name),
            messagesPreview: messages.map((m, idx) => ({
                index: idx,
                role: m.role,
                contentLength: getContentLength(m.content),
                contentPreview: getContentPreview(m.content),
                hasToolCalls: !!m.tool_calls,
                toolCallsCount: m.tool_calls?.length,
                hasToolCallId: !!m.tool_call_id,
                toolCallId: m.tool_call_id,
            })),
            lastMessage: messages[messages.length - 1]
                ? {
                      role: messages[messages.length - 1].role,
                      content: getMessageTextForTokenCounting(messages[messages.length - 1].content).substring(0, 300),
                      hasToolCalls: !!messages[messages.length - 1].tool_calls,
                      hasToolCallId: !!messages[messages.length - 1].tool_call_id,
                  }
                : null,
        })

        // Make the actual API call to OpenAI
        const apiCallStart = Date.now()
        console.log('📞 [TIMING] Calling OpenAI API...')
        const stream = await openai.chat.completions.create(requestParams)
        const apiCallDuration = Date.now() - apiCallStart
        console.log(`✅ [TIMING] OpenAI API call successful: ${apiCallDuration}ms`)

        const totalDuration = Date.now() - streamStartTime
        console.log('🌊 [TIMING] interactWithChatStream COMPLETE', {
            totalDuration: `${totalDuration}ms`,
            breakdown: {
                configLoading: `${configDuration}ms`,
                openAIClientInit: openAIInitStart ? `${Date.now() - openAIInitStart - apiCallDuration}ms` : 'N/A',
                apiCall: `${apiCallDuration}ms`,
                model,
                temperature,
            },
        })

        // Convert OpenAI stream to our expected format
        return convertOpenAIStream(stream)
    }
}

/**
 * Convert OpenAI stream chunks to our expected format
 * Accumulates tool calls across multiple chunks since OpenAI streams them incrementally
 */
async function* convertOpenAIStream(stream) {
    let accumulatedToolCalls = {}
    let chunkCount = 0
    let totalContentLength = 0

    if (ENABLE_DETAILED_LOGGING) {
        console.log('🔧 STREAM CONVERTER: Starting to process OpenAI stream')
    }

    for await (const chunk of stream) {
        chunkCount++
        const delta = chunk.choices[0]?.delta
        const finishReason = chunk.choices[0]?.finish_reason

        const logData = {
            chunkNumber: chunkCount,
            hasDelta: !!delta,
            hasContent: !!delta?.content,
            contentLength: delta?.content?.length || 0,
            content: delta?.content || '',
            hasToolCalls: !!delta?.tool_calls,
            toolCallsCount: delta?.tool_calls?.length || 0,
            finishReason: finishReason,
            hasRole: !!delta?.role,
            role: delta?.role,
        }

        if (delta?.content) {
            totalContentLength += delta.content.length
        }

        if (ENABLE_DETAILED_LOGGING) {
            console.log(`🔧 STREAM CONVERTER: Chunk #${chunkCount}:`, logData)
        }

        if (!delta && !finishReason) continue

        // Handle tool calls - OpenAI streams them in chunks
        if (delta?.tool_calls) {
            for (const toolCallChunk of delta.tool_calls) {
                const index = toolCallChunk.index

                if (!accumulatedToolCalls[index]) {
                    accumulatedToolCalls[index] = {
                        id: toolCallChunk.id || '',
                        type: toolCallChunk.type || 'function',
                        function: {
                            name: toolCallChunk.function?.name || '',
                            arguments: toolCallChunk.function?.arguments || '',
                        },
                    }
                } else {
                    // Accumulate arguments
                    if (toolCallChunk.function?.arguments) {
                        accumulatedToolCalls[index].function.arguments += toolCallChunk.function.arguments
                    }
                    if (toolCallChunk.function?.name) {
                        accumulatedToolCalls[index].function.name += toolCallChunk.function.name
                    }
                    if (toolCallChunk.id) {
                        accumulatedToolCalls[index].id = toolCallChunk.id
                    }
                }
            }

            // Don't yield incomplete tool calls yet
            continue
        }

        // If we have content, yield it
        if (delta?.content) {
            yield {
                content: delta.content,
                additional_kwargs: {},
            }
        }

        // Check if the stream is finishing (finish_reason present)
        if (finishReason === 'tool_calls') {
            // Stream is done, yield accumulated tool calls
            const completedToolCalls = Object.values(accumulatedToolCalls)
            if (completedToolCalls.length > 0) {
                if (ENABLE_DETAILED_LOGGING) {
                    console.log('🔧 STREAM: Yielding completed tool calls:', {
                        count: completedToolCalls.length,
                        calls: completedToolCalls.map(tc => ({
                            id: tc.id,
                            name: tc.function.name,
                            argsLength: tc.function.arguments.length,
                        })),
                    })
                }
                yield {
                    content: '',
                    additional_kwargs: {
                        tool_calls: completedToolCalls,
                    },
                }
            }
            accumulatedToolCalls = {} // Reset for next potential tool calls
        } else if (finishReason === 'stop') {
            if (ENABLE_DETAILED_LOGGING) {
                console.log('🔧 STREAM: Stream finished with reason: stop')
            }
        } else if (finishReason === 'length') {
            if (ENABLE_DETAILED_LOGGING) {
                console.log('🔧 STREAM: Stream finished with reason: length (max tokens)')
            }
        } else if (finishReason) {
            if (ENABLE_DETAILED_LOGGING) {
                console.log('🔧 STREAM: Stream finished with reason:', finishReason)
            }
        }
    }

    if (ENABLE_DETAILED_LOGGING) {
        console.log(`🔧 STREAM CONVERTER: Finished processing stream`, {
            totalChunks: chunkCount,
            totalContentLength,
            hadToolCalls: Object.keys(accumulatedToolCalls).length > 0,
            toolCallsCount: Object.keys(accumulatedToolCalls).length,
        })
    }
}

function formatMessage(objectType, message, assistantId) {
    const commentId = uuidv4()
    const now = Date.now()
    const comment = {
        commentText: message,
        lastChangeDate: admin.firestore.Timestamp.now(),
        created: now,
        creatorId: assistantId,
        fromAssistant: true,
    }
    if (objectType === 'tasks') comment.commentType = STAYWARD_COMMENT
    return { commentId, comment }
}

const updateLastCommentDataOfChatParentObject = async (projectId, objectId, type, lastComment, commentType) => {
    const cleanedComment = shrinkTagText(
        cleanTextMetaData(removeFormatTagsFromText(lastComment), true),
        LAST_COMMENT_CHARACTER_LIMIT_IN_BIG_SCREEN
    )

    if (type === 'assistants') {
        await updateAssistantLastCommentData(projectId, objectId, cleanedComment, commentType)
    } else if (type === 'contacts') {
        const promises = []
        promises.push(updateContactLastCommentData(projectId, objectId, cleanedComment, commentType))
        promises.push(updateUserLastCommentData(projectId, objectId, cleanedComment, commentType))
        await Promise.all(promises)
    } else if (type === 'skills') {
        await updateSkillLastCommentData(projectId, objectId, cleanedComment, commentType)
    } else if (type === 'tasks') {
        await updateTaskLastCommentData(projectId, objectId, cleanedComment, commentType)
    } else if (type === 'goals') {
        await updateGoalLastCommentData(projectId, objectId, cleanedComment, commentType)
    } else if (type === 'notes') {
        await updateNoteLastCommentData(projectId, objectId, cleanedComment, commentType)
    }
}

const getFollowerLists = async (projectId, objectType, objectId, isPublicFor) => {
    let followerIds = await getObjectFollowersIds(projectId, objectType, objectId)

    followerIds = isPublicFor.includes(FEED_PUBLIC_FOR_ALL)
        ? followerIds
        : followerIds.filter(uid => isPublicFor.includes(uid))

    return followerIds
}

const createChatInternalNotifications = (
    projectId,
    objectId,
    objectType,
    commentId,
    followrsMap,
    userIdsToNotify,
    assistantId,
    batch
) => {
    userIdsToNotify.forEach(userId => {
        batch.set(admin.firestore().doc(`chatNotifications/${projectId}/${userId}/${commentId}`), {
            chatId: objectId,
            chatType: objectType,
            followed: !!followrsMap[userId],
            date: moment().utc().valueOf(),
            creatorId: assistantId,
            creatorType: 'assistant',
        })
    })
}

const createChatEmailNotifications = (
    projectId,
    objectId,
    objectType,
    objectName,
    messageTimestamp,
    followerIds,
    batch
) => {
    // Check if followerIds array is not empty before using arrayUnion
    if (!followerIds || followerIds.length === 0) {
        console.log('No follower IDs for email notifications, skipping arrayUnion', { objectId })
        // Create with empty array instead of using arrayUnion
        batch.set(
            admin.firestore().doc(`emailNotifications/${objectId}`),
            {
                userIds: [],
                projectId,
                objectType: objectType === 'topics' ? 'chats' : objectType,
                objectId,
                objectName,
                messageTimestamp,
            },
            { merge: true }
        )
    } else {
        // Normal case with follower IDs
        batch.set(
            admin.firestore().doc(`emailNotifications/${objectId}`),
            {
                userIds: followerIds, // Use array directly for emulator
                projectId,
                objectType: objectType === 'topics' ? 'chats' : objectType,
                objectId,
                objectName,
                messageTimestamp,
            },
            { merge: true }
        )
    }
}

const createChatPushNotification = (
    projectId,
    objectId,
    followerIds,
    objectName,
    commentId,
    messageTimestamp,
    assistantName,
    projectname,
    comment,
    chatLink,
    initiatorId,
    batch
) => {
    // Check if followerIds array is not empty before creating notification
    if (!followerIds || followerIds.length === 0) {
        console.log('No follower IDs for push notifications, skipping notification creation', { objectId })
        return // Skip creating notification
    }

    // Normal case with follower IDs
    batch.set(admin.firestore().doc(`pushNotifications/${commentId}`), {
        userIds: followerIds,
        body: `${projectname}\n  ✔ ${objectName}\n ${assistantName} ${'commented'}: ${comment}`,
        link: chatLink,
        messageTimestamp,
        type: 'Chat Notification',
        chatId: objectId,
        projectId,
        initiatorId: initiatorId || null,
    })
}

const generateNotifications = (
    projectId,
    objectType,
    objectId,
    userIdsToNotify,
    objectName,
    assistantName,
    projectname,
    chatLink,
    commentId,
    lastComment,
    followerIds,
    assistantId,
    initiatorId = null
) => {
    // Ensure followerIds is at least an empty array if not provided
    const safeFollowerIds = followerIds || []

    if (safeFollowerIds.length === 0) {
        console.log('No followers to notify for this message', {
            projectId,
            objectType,
            objectId,
        })
    }

    const batch = new BatchWrapper(admin.firestore())
    const messageTimestamp = moment().utc().valueOf()
    const followersMap = {}
    safeFollowerIds.forEach(followerId => {
        followersMap[followerId] = true
    })

    // Only create notifications if there are followers or users to notify
    if (safeFollowerIds.length > 0 || (userIdsToNotify && userIdsToNotify.length > 0)) {
        createChatInternalNotifications(
            projectId,
            objectId,
            objectType,
            commentId,
            followersMap,
            userIdsToNotify,
            assistantId,
            batch
        )

        createChatEmailNotifications(
            projectId,
            objectId,
            objectType,
            objectName,
            messageTimestamp,
            safeFollowerIds,
            batch
        )

        createChatPushNotification(
            projectId,
            objectId,
            safeFollowerIds,
            objectName,
            commentId,
            messageTimestamp,
            assistantName,
            projectname,
            lastComment,
            chatLink,
            initiatorId,
            batch
        )
    }

    return batch.commit()
}

const getCurrentFollowerIds = async (followerIds, projectId, objectType, objectId, isPublicFor) => {
    try {
        // If followerIds is already provided, use that
        if (followerIds && Array.isArray(followerIds) && followerIds.length > 0) {
            console.log('Using provided follower IDs:', {
                followerCount: followerIds.length,
                projectId,
                objectType,
                objectId,
            })
            return followerIds
        }

        // Otherwise get follower IDs from the project
        console.log('Fetching follower IDs for object:', {
            projectId,
            objectType,
            objectId,
        })

        // Get the chat object first to get the taskId
        const chatDoc = await admin.firestore().doc(`chatObjects/${projectId}/chats/${objectId}`).get()
        const chat = chatDoc.data()

        if (!chat || !chat.taskId) {
            console.log('No chat or taskId found:', { objectId })
            return []
        }

        // Get the task to find the creator - first try in project
        let taskDoc = await admin
            .firestore()
            .doc(`assistantTasks/${projectId}/${chat.assistantId}/${chat.taskId}`)
            .get()
        let task = taskDoc.data()

        // If not found, try in global projects
        if (!task || !task.creatorUserId) {
            console.log('Task not found in project, checking global projects:', { taskId: chat.taskId })
            taskDoc = await admin
                .firestore()
                .doc(`assistantTasks/globalProject/${chat.assistantId}/${chat.taskId}`)
                .get()
            task = taskDoc.data()
        }

        if (!task || !task.creatorUserId) {
            console.log('No task or creatorUserId found in project or global:', { taskId: chat.taskId })
            return []
        }

        console.log('Found task creator and using that as fallback for legacy tasks:', {
            taskId: chat.taskId,
            creatorUserId: task.creatorUserId,
        })

        // Return array with just the creator ID
        // NOTE: This is a fallback for legacy scenarios. Normally activatorUserId should be used.
        return [task.creatorUserId]
    } catch (error) {
        console.error('Error in getCurrentFollowerIds:', {
            error,
            projectId,
            objectType,
            objectId,
        })
        return [] // Return empty array on error
    }
}

const updateLastAssistantCommentData = async (projectId, objectType, objectId, currentFollowerIds, creatorId) => {
    if (!Array.isArray(currentFollowerIds) || currentFollowerIds.length === 0) {
        return
    }

    const batch = admin.firestore().batch()
    const timestamp = moment().utc().valueOf()

    currentFollowerIds.forEach(followerId => {
        const ref = admin.firestore().doc(`users/${followerId}`)
        const updateDate = { objectType, objectId, creatorId, creatorType: 'assistant', date: timestamp }

        batch.update(ref, {
            [`lastAssistantCommentData.${projectId}`]: updateDate,
            [`lastAssistantCommentData.${ASSISTANT_LAST_COMMENT_ALL_PROJECTS_KEY}`]: {
                ...updateDate,
                projectId,
            },
        })
    })

    await batch.commit()
}

const normalizeProjectNameForLookup = value => (typeof value === 'string' ? value.trim().toLowerCase() : '')

const projectNamesMatch = (projectNameA, projectNameB) => {
    const a = normalizeProjectNameForLookup(projectNameA)
    const b = normalizeProjectNameForLookup(projectNameB)
    return !!a && !!b && (a === b || a.includes(b) || b.includes(a))
}

async function resolveMoveTargetProject(database, userId, moveToProjectId, moveToProjectName) {
    const requestedProjectId = typeof moveToProjectId === 'string' ? moveToProjectId.trim() : ''
    const requestedProjectName = typeof moveToProjectName === 'string' ? moveToProjectName.trim() : ''

    if (!requestedProjectId && !requestedProjectName) return null

    const { ProjectService } = require('../shared/ProjectService')
    const projectService = new ProjectService({ database })
    await projectService.initialize()

    const projects = await projectService.getUserProjects(userId, {
        includeArchived: true,
        includeCommunity: true,
        activeOnly: false,
    })
    const projectsById = new Map(projects.map(project => [project.id, project]))

    if (requestedProjectId) {
        const projectFromId = projectsById.get(requestedProjectId)
        if (!projectFromId) {
            throw new Error(`Target project not found or not accessible: "${requestedProjectId}"`)
        }
        if (requestedProjectName && !projectNamesMatch(projectFromId.name, requestedProjectName)) {
            throw new Error(
                `Target project mismatch: projectId "${requestedProjectId}" does not match projectName "${requestedProjectName}".`
            )
        }
        return {
            id: projectFromId.id,
            name: projectFromId.name,
            source: 'moveToProjectId',
        }
    }

    const exactMatches = projects.filter(
        project => normalizeProjectNameForLookup(project.name) === requestedProjectName.toLowerCase()
    )
    if (exactMatches.length === 1) {
        return {
            id: exactMatches[0].id,
            name: exactMatches[0].name,
            source: 'moveToProjectName_exact',
        }
    }

    if (exactMatches.length > 1) {
        throw new Error(
            `Multiple projects match "${requestedProjectName}". Please use moveToProjectId to choose one target project.`
        )
    }

    const partialMatches = projects.filter(project => projectNamesMatch(project.name, requestedProjectName))
    if (partialMatches.length === 1) {
        return {
            id: partialMatches[0].id,
            name: partialMatches[0].name,
            source: 'moveToProjectName_partial',
        }
    }

    if (partialMatches.length > 1) {
        const options = partialMatches
            .slice(0, 5)
            .map(project => `"${project.name}" (${project.id})`)
            .join(', ')
        throw new Error(
            `Multiple projects partially match "${requestedProjectName}": ${options}. Please use moveToProjectId.`
        )
    }

    throw new Error(`No project found matching "${requestedProjectName}".`)
}

async function collectTaskTreeForMove(database, sourceProjectId, rootTaskId) {
    const taskTree = new Map()
    const queue = [rootTaskId]

    while (queue.length > 0) {
        const taskId = queue.shift()
        if (!taskId || taskTree.has(taskId)) continue

        const taskDoc = await database.doc(`items/${sourceProjectId}/tasks/${taskId}`).get()
        if (!taskDoc.exists) {
            if (taskId === rootTaskId) {
                throw new Error(`Task ${rootTaskId} not found in source project ${sourceProjectId}`)
            }
            continue
        }

        const taskData = taskDoc.data() || {}
        taskTree.set(taskId, taskData)

        const subtaskIds = Array.isArray(taskData.subtaskIds) ? taskData.subtaskIds : []
        subtaskIds.forEach(subtaskId => {
            if (typeof subtaskId === 'string' && subtaskId.trim() && !taskTree.has(subtaskId)) {
                queue.push(subtaskId)
            }
        })
    }

    return taskTree
}

async function moveTaskToDifferentProject(params) {
    const { database, sourceProjectId, targetProjectId, taskId, editorId, editorName } = params

    if (!sourceProjectId || !targetProjectId || !taskId) {
        throw new Error('sourceProjectId, targetProjectId and taskId are required for task move')
    }
    if (sourceProjectId === targetProjectId) {
        return {
            moved: false,
            reason: 'already_in_target_project',
            sourceProjectId,
            targetProjectId,
            taskId,
            movedTaskCount: 1,
        }
    }

    const taskTree = await collectTaskTreeForMove(database, sourceProjectId, taskId)
    const taskIdsToMove = Array.from(taskTree.keys())
    const timestamp = Date.now()

    // Protect against accidental overwrite in the target project.
    for (const id of taskIdsToMove) {
        const targetTaskDoc = await database.doc(`items/${targetProjectId}/tasks/${id}`).get()
        if (targetTaskDoc.exists) {
            throw new Error(
                `Cannot move task ${taskId}: task ID ${id} already exists in target project ${targetProjectId}.`
            )
        }
    }

    for (const [id, sourceTask] of taskTree.entries()) {
        const isRootTask = id === taskId
        const movedTask = {
            ...sourceTask,
            lastEditionDate: timestamp,
        }

        if (editorId) movedTask.lastEditorId = editorId
        if (editorName) movedTask.lastEditorName = editorName

        // Remove move marker/internal path hints from the copied task.
        delete movedTask.movingToOtherProjectId
        delete movedTask.projectId

        // Goals are project-local, so the moved task should no longer point to an old project goal.
        movedTask.parentGoalId = null
        movedTask.parentGoalIsPublicFor = null
        movedTask.lockKey = ''

        // Root subtasks become root tasks after moving project, matching app move behavior.
        if (isRootTask && movedTask.parentId) {
            movedTask.parentId = null
            movedTask.isSubtask = false
            movedTask.parentDone = false
            movedTask.inDone = !!movedTask.done
            if (movedTask.done && !movedTask.completed) movedTask.completed = timestamp
        }

        if (movedTask.calendarData && typeof movedTask.calendarData === 'object') {
            movedTask.calendarData = {
                ...movedTask.calendarData,
                pinnedToProjectId: targetProjectId,
            }
        }

        await database.doc(`items/${targetProjectId}/tasks/${id}`).set(movedTask)
    }

    const sourceMoveMarkerUpdate = {
        movingToOtherProjectId: targetProjectId,
        lastEditionDate: timestamp,
    }
    if (editorId) sourceMoveMarkerUpdate.lastEditorId = editorId
    if (editorName) sourceMoveMarkerUpdate.lastEditorName = editorName

    // Mark all source tasks as moved so delete triggers can preserve linked content (notes/backlinks).
    for (const id of taskIdsToMove) {
        try {
            await database.doc(`items/${sourceProjectId}/tasks/${id}`).update(sourceMoveMarkerUpdate)
        } catch (error) {
            console.warn('Task move: failed to set move marker on source task', {
                taskId: id,
                sourceProjectId,
                error: error.message,
            })
        }
    }

    // Delete only root task; existing delete triggers cascade source subtasks cleanup.
    await database.doc(`items/${sourceProjectId}/tasks/${taskId}`).delete()

    return {
        moved: true,
        sourceProjectId,
        targetProjectId,
        taskId,
        movedTaskCount: taskIdsToMove.length,
    }
}

async function moveNoteToDifferentProject(params) {
    const { database, sourceProjectId, targetProjectId, noteId, editorId, editorName, notesBucketName } = params

    if (!sourceProjectId || !targetProjectId || !noteId) {
        throw new Error('sourceProjectId, targetProjectId and noteId are required for note move')
    }
    if (sourceProjectId === targetProjectId) {
        return {
            moved: false,
            reason: 'already_in_target_project',
            sourceProjectId,
            targetProjectId,
            noteId,
        }
    }

    const sourceNoteRef = database.doc(`noteItems/${sourceProjectId}/notes/${noteId}`)
    const sourceNoteDoc = await sourceNoteRef.get()
    if (!sourceNoteDoc.exists) {
        throw new Error(`Note ${noteId} not found in source project ${sourceProjectId}`)
    }

    const targetNoteRef = database.doc(`noteItems/${targetProjectId}/notes/${noteId}`)
    const targetNoteDoc = await targetNoteRef.get()
    if (targetNoteDoc.exists) {
        throw new Error(`Cannot move note ${noteId}: target project already contains this note ID.`)
    }

    const timestamp = Date.now()
    const sourceNote = sourceNoteDoc.data() || {}
    const movedNote = {
        ...sourceNote,
        lastEditionDate: timestamp,
    }
    if (editorId) movedNote.lastEditorId = editorId
    if (editorName) movedNote.lastEditorName = editorName
    delete movedNote.movingToOtherProjectId

    if (!notesBucketName) {
        throw new Error('Could not resolve notes storage bucket for note move.')
    }

    const notesBucket = admin.storage().bucket(notesBucketName)
    const sourceFile = notesBucket.file(`notesData/${sourceProjectId}/${noteId}`)
    const [exists] = await sourceFile.exists()
    if (exists) {
        await sourceFile.copy(`gs://${notesBucketName}/notesData/${targetProjectId}/${noteId}`)
    }

    await targetNoteRef.set(movedNote)

    const sourceMoveMarkerUpdate = {
        movingToOtherProjectId: targetProjectId,
        lastEditionDate: timestamp,
    }
    if (editorId) sourceMoveMarkerUpdate.lastEditorId = editorId
    if (editorName) sourceMoveMarkerUpdate.lastEditorName = editorName

    await sourceNoteRef.update(sourceMoveMarkerUpdate)
    await sourceNoteRef.delete()

    return {
        moved: true,
        sourceProjectId,
        targetProjectId,
        noteId,
    }
}

async function executeDelegatedAssistantRequest({
    target,
    toolArgs,
    requestUserId,
    callerProjectId,
    callerAssistantId,
    userContext = null,
}) {
    const message = typeof toolArgs?.message === 'string' ? toolArgs.message.trim() : ''
    if (!message) {
        throw new Error('talk_to_assistant requires a non-empty "message" argument')
    }

    const currentDepth = Number.isFinite(userContext?.delegationDepth) ? userContext.delegationDepth : 0
    if (currentDepth >= MAX_ASSISTANT_DELEGATION_DEPTH) {
        throw new Error(`Maximum delegation depth reached (${MAX_ASSISTANT_DELEGATION_DEPTH})`)
    }

    const callerNode = `${callerProjectId}:${callerAssistantId}`
    const targetNode = `${target.projectId}:${target.assistantId}`
    const existingPath = Array.isArray(userContext?.delegationPath) ? userContext.delegationPath : [callerNode]
    if (existingPath.includes(targetNode)) {
        throw new Error('Delegation loop detected')
    }

    const db = admin.firestore()
    const targetAssistantDoc = await db.doc(`assistants/${target.projectId}/items/${target.assistantId}`).get()
    if (!targetAssistantDoc.exists) {
        throw new Error('Target assistant no longer exists or is not accessible')
    }

    const targetAssistant = targetAssistantDoc.data() || {}
    const targetAllowedTools = Array.isArray(targetAssistant.allowedTools) ? targetAssistant.allowedTools : []
    const targetModel = normalizeModelKey(targetAssistant.model || MODEL_GPT5_4)
    const targetTemperature = targetAssistant.temperature || TEMPERATURE_NORMAL
    const targetDisplayName = targetAssistant.displayName || target.displayName || 'Assistant'
    const targetInstructions = targetAssistant.instructions || 'You are a helpful assistant.'

    console.log('🔁 DELEGATION: executeDelegatedAssistantRequest target loaded', {
        callerProjectId,
        callerAssistantId,
        requestUserId,
        targetToolName: target?.toolName || null,
        targetProjectId: target?.projectId || null,
        targetProjectName: target?.projectName || null,
        targetAssistantId: target?.assistantId || null,
        targetDisplayName,
        targetModel,
        targetTemperature,
        targetAllowedToolsCount: targetAllowedTools.length,
        targetAllowedTools,
        hasExternalToolsToggle: targetAllowedTools.includes(EXTERNAL_TOOLS_KEY),
        hasDelegationToggle: targetAllowedTools.includes(TALK_TO_ASSISTANT_TOOL_KEY),
    })

    const delegatedUserContext = {
        ...(userContext || {}),
        delegationDepth: currentDepth + 1,
        delegationPath: [...existingPath, targetNode],
        delegatedByAssistantId: callerAssistantId,
        delegatedByProjectId: callerProjectId,
    }
    const delegatedToolRuntimeContext = {
        projectId: target.projectId,
        assistantId: target.assistantId,
        requestUserId,
    }

    const messages = []
    await addBaseInstructions(messages, targetDisplayName, 'English', targetInstructions, targetAllowedTools, null, {
        projectId: target.projectId,
        assistantId: target.assistantId,
        requestUserId,
    })
    messages.push([
        'system',
        `You are handling a delegated request from assistant "${callerAssistantId}" in project "${callerProjectId}". ` +
            'Complete the task and return a concise result for the calling assistant. Use your available tools when needed.',
    ])
    messages.push(['user', parseTextForUseLiKePrompt(message)])

    const stream = await interactWithChatStream(
        messages,
        targetModel,
        targetTemperature,
        targetAllowedTools,
        delegatedToolRuntimeContext
    )
    const delegationRun = await collectAssistantTextWithToolCalls({
        stream,
        conversationHistory: messages,
        modelKey: targetModel,
        temperatureKey: targetTemperature,
        allowedTools: targetAllowedTools,
        toolRuntimeContext: delegatedToolRuntimeContext,
        userContext: delegatedUserContext,
    })
    const assistantResponse = delegationRun?.assistantResponse || ''
    const executedToolCallsCount = Number(delegationRun?.executedToolCallsCount) || 0
    const executedToolNames = Array.isArray(delegationRun?.executedToolNames) ? delegationRun.executedToolNames : []
    const targetHasEnabledTools = targetAllowedTools.length > 0
    const requiresToolExecution = messageLikelyRequiresToolExecution(message)

    // Charge the delegated run separately so delegation costs are fully accounted for.
    if (requestUserId) {
        try {
            const billingUserDoc = await db.collection('users').doc(requestUserId).get()
            const billingUserGold = billingUserDoc.exists ? billingUserDoc.data()?.gold || 0 : 0

            await reduceGoldWhenChatWithAI(requestUserId, billingUserGold, targetModel, assistantResponse, messages)

            console.log('🔁 DELEGATION: billed delegated assistant run', {
                requestUserId,
                targetProjectId: target.projectId,
                targetAssistantId: target.assistantId,
                targetModel,
                executedToolCallsCount,
                assistantResponseLength: assistantResponse.length,
            })
        } catch (billingError) {
            console.error('🔁 DELEGATION: failed to bill delegated assistant run', {
                requestUserId,
                targetProjectId: target.projectId,
                targetAssistantId: target.assistantId,
                targetModel,
                error: billingError.message,
            })
        }
    } else {
        console.warn('🔁 DELEGATION: skipped billing delegated assistant run because requestUserId is missing', {
            callerProjectId,
            callerAssistantId,
            targetProjectId: target.projectId,
            targetAssistantId: target.assistantId,
            targetModel,
        })
    }

    let success = true
    let status = 'success'
    let warning = null

    // Delegated runs are allowed to answer directly without tool calls.
    // Keep this as a warning only for observability on action-oriented requests.
    if (executedToolCallsCount === 0 && requiresToolExecution) {
        status = 'no_tool_executed'
        warning = 'Delegated assistant returned a direct answer without executing tool calls.'
    }

    console.log('🔁 DELEGATION: execution outcome', {
        callerProjectId,
        callerAssistantId,
        targetProjectId: target.projectId,
        targetAssistantId: target.assistantId,
        requiresToolExecution,
        targetHasEnabledTools,
        executedToolCallsCount,
        executedToolNames,
        success,
        status,
        warning,
    })

    return {
        success,
        status,
        targetAssistantId: target.assistantId,
        targetAssistantName: targetDisplayName,
        targetProjectId: target.projectId,
        targetProjectName: target.projectName,
        assistantResponse,
        warning,
        requiresToolExecution,
        targetAllowedToolsCount: targetAllowedTools.length,
        executedToolCallsCount,
        executedToolNames,
        delegationDepth: delegatedUserContext.delegationDepth,
    }
}

async function executeExternalIntegrationTool({ target, toolArgs, requestUserId, callerProjectId, callerAssistantId }) {
    if (!target?.execution?.url) {
        throw new Error('External tool execution URL is missing')
    }

    const requestId = uuidv4()
    const method = target.execution.method || 'POST'
    const timeoutMs = Number(target.execution.timeoutMs) || 10000
    const userIdentity = await getExternalToolUserIdentity(requestUserId)
    const userEmail = userIdentity.email || userIdentity.notificationEmail || ''
    const payload = {
        toolKey: target.toolKey,
        arguments: isObject(toolArgs) ? toolArgs : {},
        args: isObject(toolArgs) ? toolArgs : {},
        input: isObject(toolArgs) ? toolArgs : {},
        context: {
            requestId,
            userId: requestUserId || '',
            alldoneUserId: requestUserId || '',
            userEmail,
            alldoneUserEmail: userEmail,
            assistantId: callerAssistantId || '',
            alldoneAssistantId: callerAssistantId || '',
            projectId: callerProjectId || '',
            alldoneProjectId: callerProjectId || '',
            integrationId: target.integrationId || '',
            taskId: target.taskId || '',
        },
    }

    const headers = {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'X-Alldone-Request-Id': requestId,
        'X-Alldone-Tool-Key': target.toolKey || '',
        'X-Alldone-User-Id': requestUserId || '',
        'X-Alldone-User-Email': userEmail,
        'X-Alldone-Assistant-Id': callerAssistantId || '',
        'X-Alldone-Project-Id': callerProjectId || '',
    }

    const envFunctions = getCachedEnvFunctions()
    const signingSecret = envFunctions?.EXTERNAL_TOOLS_SIGNING_SECRET || ''
    const timestamp = Date.now().toString()
    const body = JSON.stringify(payload)
    if (signingSecret) {
        const signature = crypto.createHmac('sha256', signingSecret).update(`${timestamp}.${body}`).digest('hex')
        headers['X-Alldone-Timestamp'] = timestamp
        headers['X-Alldone-Signature'] = signature
    }

    let url = target.execution.url
    const requestInit = {
        method,
        headers,
        signal: AbortSignal.timeout(Math.min(30000, Math.max(1000, timeoutMs))),
    }

    console.log('🌐 EXTERNAL TOOL: Dispatching request', {
        requestId,
        integrationId: target.integrationId,
        integrationName: target.integrationName,
        toolKey: target.toolKey,
        toolName: target.displayName,
        method,
        url,
        timeoutMs,
        argsKeys: Object.keys(payload.arguments || {}),
        hasUserEmail: !!userEmail,
        hasSigningSecret: !!signingSecret,
    })

    if (method === 'GET') {
        const parsedUrl = new URL(url)
        parsedUrl.searchParams.set('toolKey', target.toolKey || '')
        parsedUrl.searchParams.set('requestId', requestId)
        parsedUrl.searchParams.set('args', JSON.stringify(payload.arguments || {}))
        parsedUrl.searchParams.set('context', JSON.stringify(payload.context || {}))
        url = parsedUrl.toString()
    } else {
        requestInit.body = body
    }

    const response = await fetch(url, requestInit)
    const rawText = await response.text()

    let responseData = null
    if (rawText && rawText.trim()) {
        try {
            responseData = JSON.parse(rawText)
        } catch (_) {
            responseData = { raw: rawText.trim() }
        }
    }

    console.log('🌐 EXTERNAL TOOL: Response received', {
        requestId,
        status: response.status,
        ok: response.ok,
        hasBody: !!rawText,
        responseSuccess: responseData?.success,
        responseStatus: responseData?.status,
        responseError: responseData?.error || responseData?.message || '',
    })

    if (!response.ok) {
        const remoteError = responseData?.error || responseData?.message || `HTTP ${response.status}`
        throw new Error(`External tool failed (${target.displayName}, request ${requestId}): ${remoteError}`)
    }

    if (responseData?.success === false) {
        const remoteError = responseData?.error || responseData?.message || 'External tool returned success=false'
        throw new Error(`External tool rejected (${target.displayName}, request ${requestId}): ${remoteError}`)
    }

    return {
        success: responseData?.success !== false,
        requestId,
        integrationId: target.integrationId,
        integrationName: target.integrationName,
        toolKey: target.toolKey,
        toolName: target.displayName,
        status: responseData?.status || 'ok',
        result: Object.prototype.hasOwnProperty.call(responseData || {}, 'result') ? responseData.result : responseData,
    }
}

/**
 * Execute a tool natively and return the raw result (not processed by LLM)
 * This is used for OpenAI native tool calling
 */
async function executeToolNatively(
    toolName,
    toolArgs,
    projectId,
    assistantId,
    requestUserId,
    userContext,
    toolRuntimeContext = null
) {
    console.log('🔧 executeToolNatively:', { toolName, toolArgs, projectId })

    const admin = require('firebase-admin')

    // Get creator ID - use requestUserId if available, otherwise use assistantId
    const creatorId = requestUserId || assistantId

    if (isTalkToAssistantToolName(toolName)) {
        const callerAssistant = await getAssistantForChat(projectId, assistantId, requestUserId, {
            forceRefresh: true,
        })
        const callerAllowedTools = Array.isArray(callerAssistant?.allowedTools) ? callerAssistant.allowedTools : []

        if (!callerAllowedTools.includes(TALK_TO_ASSISTANT_TOOL_KEY)) {
            throw new Error(`Tool not permitted: ${toolName}`)
        }

        const target = await resolveDelegationTargetByToolName(toolName, {
            projectId,
            assistantId,
            requestUserId,
        })
        if (!target) {
            throw new Error(`Delegation target is not accessible: ${toolName}`)
        }

        console.log('🔁 DELEGATION: tool call target selected', {
            toolName,
            callerProjectId: projectId || null,
            callerAssistantId: assistantId || null,
            requestUserId: requestUserId || null,
            targetProjectId: target.projectId,
            targetProjectName: target.projectName,
            targetAssistantId: target.assistantId,
            targetDisplayName: target.displayName,
        })

        return executeDelegatedAssistantRequest({
            target,
            toolArgs,
            requestUserId,
            callerProjectId: projectId,
            callerAssistantId: assistantId,
            userContext,
        })
    }

    if (isExternalIntegrationToolName(toolName)) {
        const callerAssistant = await getAssistantForChat(projectId, assistantId, requestUserId, {
            forceRefresh: true,
        })
        const callerAllowedTools = Array.isArray(callerAssistant?.allowedTools) ? callerAssistant.allowedTools : []

        if (!callerAllowedTools.includes(EXTERNAL_TOOLS_KEY)) {
            throw new Error(`Tool not permitted: ${toolName}`)
        }

        const target = await resolveExternalIntegrationToolTargetByName(toolName, {
            projectId,
            assistantId,
            requestUserId,
        })

        if (!target) {
            throw new Error(`External tool is not accessible: ${toolName}`)
        }

        return executeExternalIntegrationTool({
            target,
            toolArgs,
            requestUserId,
            callerProjectId: projectId,
            callerAssistantId: assistantId,
        })
    }

    switch (toolName) {
        case 'create_task': {
            const { TaskService } = require('../shared/TaskService')
            const { UserHelper } = require('../shared/UserHelper')
            const moment = require('moment-timezone')
            const db = admin.firestore()

            // Determine target project ID with three-level fallback
            // 1. Explicit projectId in toolArgs (highest priority)
            // 2. Project name resolution (if projectName provided)
            // 3. Current assistant project (required default behavior)
            let targetProjectId = toolArgs.projectId
            let targetProjectName = null

            // Project name resolution (if name provided but no ID)
            if (!targetProjectId && toolArgs.projectName) {
                const { ProjectService } = require('../shared/ProjectService')
                const projectService = new ProjectService({ database: db })
                await projectService.initialize()

                const projects = await projectService.getUserProjects(creatorId, {
                    includeArchived: false,
                    includeCommunity: false,
                })

                // Case-insensitive partial match
                const matchingProject = projects.find(
                    p => p.name && p.name.toLowerCase().includes(toolArgs.projectName.toLowerCase())
                )

                if (matchingProject) {
                    targetProjectId = matchingProject.id
                    targetProjectName = matchingProject.name
                    console.log('📝 CREATE_TASK TOOL: Resolved project name to ID', {
                        projectName: toolArgs.projectName,
                        projectId: matchingProject.id,
                        projectFullName: matchingProject.name,
                    })
                } else {
                    throw new Error(`Project not found: "${toolArgs.projectName}"`)
                }
            }

            // Fallback to current assistant project
            if (!targetProjectId) {
                try {
                    const candidateProjectIds = []
                    const appendProjectId = value => {
                        if (typeof value === 'string' && value.trim() && !candidateProjectIds.includes(value.trim())) {
                            candidateProjectIds.push(value.trim())
                        }
                    }

                    // Prioritize likely assistant locations first
                    appendProjectId(projectId)

                    const userDoc = await db.collection('users').doc(creatorId).get()
                    if (userDoc.exists) {
                        const userData = userDoc.data() || {}
                        appendProjectId(userData.defaultProjectId)
                        if (Array.isArray(userData.projectIds)) {
                            userData.projectIds.forEach(pid => appendProjectId(pid))
                        }
                    }

                    // Global assistant is valid in this app and can own preconfigured tasks
                    appendProjectId(GLOBAL_PROJECT_ID)

                    if (candidateProjectIds.length > 0) {
                        const assistantRefs = candidateProjectIds.map(pid =>
                            db.doc(`assistants/${pid}/items/${assistantId}`)
                        )
                        const assistantDocs = await db.getAll(...assistantRefs)
                        const assistantIndex = assistantDocs.findIndex(doc => doc.exists)

                        if (assistantIndex >= 0) {
                            targetProjectId = candidateProjectIds[assistantIndex]
                            if (targetProjectId !== GLOBAL_PROJECT_ID) {
                                const assistantProjectDoc = await db.collection('projects').doc(targetProjectId).get()
                                if (assistantProjectDoc.exists) {
                                    targetProjectName = assistantProjectDoc.data().name || null
                                }
                            }
                        }
                    }
                } catch (error) {
                    console.error('Error resolving assistant project for create_task:', error)
                }
            }

            if (!targetProjectId) {
                throw new Error(
                    'No project specified and no assistant project found. Please specify a projectId or projectName.'
                )
            }

            console.log('📝 CREATE_TASK TOOL: Project selection', {
                toolArgsProjectId: toolArgs.projectId,
                toolArgsProjectName: toolArgs.projectName,
                contextProjectId: projectId,
                selectedProjectId: targetProjectId,
                source: toolArgs.projectId
                    ? 'toolArgs.projectId'
                    : toolArgs.projectName
                    ? 'toolArgs.projectName'
                    : 'assistantProject',
            })

            // Get user data for feed creation and timezone
            const feedUser = await UserHelper.getFeedUserData(db, creatorId)

            // Get user's timezone for date parsing (normalize across possible fields)
            const userDoc = await db.collection('users').doc(creatorId).get()
            const userData = userDoc.data()
            let timezoneOffset = 0
            try {
                const { TaskRetrievalService } = require('../shared/TaskRetrievalService')
                const rawTz =
                    (typeof userData?.timezone !== 'undefined' ? userData.timezone : null) ??
                    (typeof userData?.timezoneOffset !== 'undefined' ? userData.timezoneOffset : null) ??
                    (typeof userData?.timezoneMinutes !== 'undefined' ? userData.timezoneMinutes : null) ??
                    (typeof userData?.preferredTimezone !== 'undefined' ? userData.preferredTimezone : null)
                const normalized = TaskRetrievalService.normalizeTimezoneOffset(rawTz)
                timezoneOffset = typeof normalized === 'number' ? normalized : timezoneOffset
            } catch (_) {}

            console.log('📝 CREATE_TASK TOOL: User timezone info', {
                userId: creatorId,
                timezoneOffset,
                hasTimezone: !!userData?.timezone,
            })

            // Handle dueDate with timezone conversion if it's a string
            let processedDueDate = toolArgs.dueDate
            if (toolArgs.dueDate && typeof toolArgs.dueDate === 'string') {
                console.log('📝 CREATE_TASK TOOL: Processing dueDate ISO string with timezone', {
                    originalDueDate: toolArgs.dueDate,
                    timezoneOffset,
                })

                // Respect embedded timezone if present; otherwise interpret as user's local time
                const parsed = moment.parseZone(toolArgs.dueDate)
                if (
                    parsed &&
                    parsed.isValid() &&
                    parsed.utcOffset() !== 0 &&
                    /[zZ]|[+-]\d{2}:?\d{2}$/.test(toolArgs.dueDate)
                ) {
                    processedDueDate = parsed.valueOf()
                } else {
                    // Interpret provided local clock time in user's timezone and convert to UTC ms
                    processedDueDate = moment(toolArgs.dueDate).utcOffset(timezoneOffset, true).valueOf()
                }

                console.log('📝 CREATE_TASK TOOL: Converted dueDate', {
                    from: toolArgs.dueDate,
                    to: processedDueDate,
                    asDate: new Date(processedDueDate).toISOString(),
                })
            }

            // Validate alert requirements
            if (toolArgs.alertEnabled && !processedDueDate) {
                throw new Error('Cannot enable alert without setting a due date/reminder time')
            }

            // Initialize or reuse TaskService instance (performance optimization)
            if (!cachedTaskService) {
                cachedTaskService = new TaskService({
                    database: db,
                    moment: moment,
                    idGenerator: () => db.collection('_').doc().id,
                    enableFeeds: true,
                    enableValidation: true,
                    isCloudFunction: true,
                    taskBatchSize: 100,
                    maxBatchesPerProject: 20,
                })
                await cachedTaskService.initialize()
            }

            try {
                const gmailTaskData = buildGmailTaskDataFromRuntimeContext(toolRuntimeContext, targetProjectId)
                // Create task using unified service
                const result = await cachedTaskService.createAndPersistTask(
                    {
                        name: sanitizeGmailFollowUpTaskName(toolArgs.name, gmailTaskData),
                        description: toolArgs.description || '',
                        dueDate: processedDueDate,
                        userId: creatorId,
                        projectId: targetProjectId,
                        isPrivate: false,
                        feedUser,
                        gmailData: gmailTaskData,
                    },
                    {
                        userId: creatorId,
                        projectId: targetProjectId,
                    }
                )

                // Enforce strict create_task result contract to prevent undefined IDs leaking to user messages
                const creationSucceeded = result?.success !== false
                const resolvedTaskId = result?.taskId || result?.taskid || result?.id || result?.task?.id || null
                const resolvedProjectId = targetProjectId || result?.projectId || result?.projectid || null

                if (!creationSucceeded) {
                    throw new Error(result?.message || 'Task creation returned unsuccessful result')
                }
                if (!resolvedTaskId || !resolvedProjectId) {
                    console.error('📝 CREATE_TASK TOOL: Invalid result contract', {
                        success: result?.success,
                        taskId: result?.taskId,
                        projectId: result?.projectId,
                        resultKeys: result ? Object.keys(result) : [],
                    })
                    throw new Error('Task created without valid taskId/projectId')
                }

                // Handle alert if alertEnabled is true
                if (toolArgs.alertEnabled && processedDueDate) {
                    console.log('📝 CREATE_TASK TOOL: Enabling alert', {
                        taskId: resolvedTaskId,
                        dueDate: processedDueDate,
                    })

                    const { setTaskAlertCloud } = require('../shared/AlertService')

                    // Convert UTC timestamp to moment with user's timezone for setTaskAlert
                    const alertMoment = moment(processedDueDate).utcOffset(timezoneOffset)

                    console.log('📝 CREATE_TASK TOOL: Calling setTaskAlert', {
                        taskId: resolvedTaskId,
                        projectId: resolvedProjectId,
                        alertTime: alertMoment.format('YYYY-MM-DD HH:mm:ss'),
                    })

                    // Update alert server-side (Cloud)
                    await setTaskAlertCloud(resolvedProjectId, resolvedTaskId, true, alertMoment, {
                        ...result.task,
                        dueDate: processedDueDate,
                    })

                    console.log('📝 CREATE_TASK TOOL: Alert enabled successfully')
                }

                // Fetch project name if not already resolved (for context/default project fallbacks)
                if (!targetProjectName && resolvedProjectId) {
                    try {
                        const projectDoc = await db.collection('projects').doc(resolvedProjectId).get()
                        if (projectDoc.exists) {
                            targetProjectName = projectDoc.data().name || null
                        }
                    } catch (error) {
                        console.error('Error fetching project name:', error)
                    }
                }

                return {
                    success: true,
                    taskId: resolvedTaskId,
                    projectId: resolvedProjectId,
                    projectName: targetProjectName,
                    message: result.message,
                    task: result.task,
                }
            } catch (error) {
                console.error('Error creating task:', error)
                throw new Error(`Failed to create task: ${error.message}`)
            }
        }

        case 'create_note': {
            const { NoteService } = require('../shared/NoteService')
            const { UserHelper } = require('../shared/UserHelper')
            const db = admin.firestore()

            // Get user data for feed creation using shared helper
            const feedUser = await UserHelper.getFeedUserData(db, creatorId)

            // Initialize or reuse NoteService instance (performance optimization)
            if (!cachedNoteService) {
                let storageBucket = null
                try {
                    // Explicitly detect bucket from admin app to avoid detection failures in NoteService
                    const adminProjectId = admin.app && admin.app().options && admin.app().options.projectId
                    const gcpProject = process.env.GCP_PROJECT
                    const gcloudProject = process.env.GCLOUD_PROJECT

                    if (
                        adminProjectId === 'alldonealeph' ||
                        gcpProject === 'alldonealeph' ||
                        gcloudProject === 'alldonealeph'
                    ) {
                        storageBucket = 'notescontentprod'
                    } else if (
                        adminProjectId === 'alldonestaging' ||
                        gcpProject === 'alldonestaging' ||
                        gcloudProject === 'alldonestaging'
                    ) {
                        storageBucket = 'notescontentstaging'
                    }

                    // Default/Dev will handle itself or fall back in NoteService
                    if (storageBucket)
                        console.log('Internal Assistant: Explicitly setting storage bucket:', storageBucket)
                } catch (e) {
                    console.warn('Internal Assistant: Failed to determine storage bucket from admin app', e)
                }

                cachedNoteService = new NoteService({
                    database: db,
                    moment: moment,
                    idGenerator: () => db.collection('_').doc().id,
                    enableFeeds: true,
                    enableValidation: true,
                    isCloudFunction: true,
                    storageBucket: storageBucket,
                })
                await cachedNoteService.initialize()
            }

            try {
                // Create note using unified service
                const result = await cachedNoteService.createAndPersistNote(
                    {
                        title: toolArgs.title,
                        content: toolArgs.content,
                        userId: creatorId,
                        projectId: projectId,
                        isPrivate: false,
                        feedUser,
                    },
                    {
                        userId: creatorId,
                        projectId: projectId,
                    }
                )

                return {
                    success: result.success,
                    noteId: result.noteId,
                    message: result.message,
                    note: result.note,
                }
            } catch (error) {
                console.error('Error creating note:', error)
                throw new Error(`Failed to create note: ${error.message}`)
            }
        }

        case 'get_tasks': {
            const { TaskRetrievalService } = require('../shared/TaskRetrievalService')
            const { ProjectService } = require('../shared/ProjectService')

            // Get user data
            const userDoc = await admin.firestore().collection('users').doc(creatorId).get()
            if (!userDoc.exists) {
                throw new Error('User not found')
            }
            const userData = userDoc.data()

            // Normalize user's timezone for proper calendar time conversion (check multiple possible fields)
            const rawTz =
                (typeof userData?.timezone !== 'undefined' ? userData.timezone : null) ??
                (typeof userData?.timezoneOffset !== 'undefined' ? userData.timezoneOffset : null) ??
                (typeof userData?.timezoneMinutes !== 'undefined' ? userData.timezoneMinutes : null) ??
                (typeof userData?.preferredTimezone !== 'undefined' ? userData.preferredTimezone : null)
            const timezoneOffset = TaskRetrievalService.normalizeTimezoneOffset(rawTz)

            console.log('📋 GET_TASKS TOOL: Request params', {
                userId: creatorId,
                status: toolArgs.status || 'open',
                date: toolArgs.date || null,
                limit: toolArgs.limit || 100,
                allProjects: toolArgs.allProjects || false,
                rawTimezone: rawTz,
                normalizedTimezoneOffset: timezoneOffset,
            })

            // Get projects with database interface
            const projectService = new ProjectService({
                database: admin.firestore(),
            })

            const effectiveStatus = toolArgs.status || 'open'
            if (toolArgs.date && effectiveStatus === 'all') {
                throw new Error(
                    'Date filtering is not supported when status is "all". Please specify status "open" to filter by due date, or "done" to filter by completion date.'
                )
            }

            await projectService.initialize()

            const includeArchived = toolArgs.includeArchived || false
            const includeCommunity = toolArgs.includeCommunity || false

            const projectsData = await projectService.getUserProjects(creatorId, {
                includeArchived,
                includeCommunity,
            })

            // Initialize TaskRetrievalService with database
            const retrievalService = new TaskRetrievalService({
                database: admin.firestore(),
                moment: require('moment'),
                isCloudFunction: true,
            })
            await retrievalService.initialize()

            // If allProjects is true, get tasks from all projects
            // Limit: default 1000, max 1000
            const taskLimit = Math.min(toolArgs.limit || 1000, 1000)
            let tasks = []
            if (toolArgs.allProjects) {
                const projectIds = projectsData.map(p => p.id)
                const result = await retrievalService.getTasksFromMultipleProjects(
                    {
                        userId: creatorId,
                        status: toolArgs.status || 'open',
                        date: toolArgs.date || null,
                        limit: taskLimit,
                        perProjectLimit: taskLimit,
                        selectMinimalFields: true,
                        timezoneOffset,
                    },
                    projectIds,
                    projectsData.reduce((acc, p) => {
                        acc[p.id] = p
                        return acc
                    }, {})
                )
                tasks = (result.tasks || []).slice(0, taskLimit)
            } else {
                // Get tasks from single project
                const result = await retrievalService.getTasks({
                    projectId: projectId,
                    userId: creatorId,
                    status: toolArgs.status || 'open',
                    date: toolArgs.date || null,
                    limit: taskLimit,
                    selectMinimalFields: true,
                    timezoneOffset,
                })
                tasks = result.tasks || []
            }

            console.log('📋 GET_TASKS TOOL: Results', {
                tasksReturned: tasks.length,
                limit: taskLimit,
            })

            return {
                tasks: tasks.map(t => ({
                    id: t.documentId || t.id,
                    name: t.name,
                    completed: !!t.done,
                    projectName: t.projectName,
                    dueDate: t.dueDate,
                    humanReadableId: t.humanReadableId || null,
                    sortIndex: t.sortIndex || 0,
                    parentGoal: t.parentGoal || null,
                    calendarTime: t.calendarTime || null,
                    isFocus: t.isFocus || false,
                })),
                count: tasks.length,
            }
        }

        case 'get_user_projects': {
            const { ProjectService } = require('../shared/ProjectService')

            const userDoc = await admin.firestore().collection('users').doc(creatorId).get()
            if (!userDoc.exists) {
                throw new Error('User not found')
            }
            const userData = userDoc.data()

            const projectService = new ProjectService({
                database: admin.firestore(),
            })
            await projectService.initialize()

            const includeArchived = toolArgs.includeArchived || false
            const includeCommunity = toolArgs.includeCommunity || false

            const projects = await projectService.getUserProjects(creatorId, {
                includeArchived,
                includeCommunity,
            })

            return {
                projects: projects.map(p => ({
                    id: p.id,
                    name: p.name,
                    type: p.type,
                    description: p.description,
                })),
                count: projects.length,
            }
        }

        case 'get_focus_task': {
            const { FocusTaskService } = require('../shared/FocusTaskService')
            const { TaskRetrievalService } = require('../shared/TaskRetrievalService')

            // Get user's timezone for proper date/time calculations
            const userDoc = await admin.firestore().collection('users').doc(creatorId).get()
            const userData = userDoc.exists ? userDoc.data() : {}
            const timezoneOffset = TaskRetrievalService.normalizeTimezoneOffset(userData?.timezone)

            console.log('📝 GET_FOCUS_TASK TOOL: User timezone info', {
                userId: creatorId,
                timezoneOffset,
                hasTimezone: !!userData?.timezone,
            })

            const focusTaskService = new FocusTaskService({
                database: admin.firestore(),
                moment: require('moment'),
                isCloudFunction: true,
            })
            await focusTaskService.initialize()

            // Use projectId from tool args if provided, otherwise null for cross-project search
            // This matches the MCP implementation and enables intelligent cross-project prioritization
            const targetProjectId = toolArgs.projectId || null

            // Support forceNew parameter for "what should I work on next?" queries
            const forceNew = toolArgs.forceNew || false

            const result = await focusTaskService.getFocusTask(creatorId, targetProjectId, {
                selectMinimalFields: true,
                forceNew: forceNew,
                timezoneOffset: timezoneOffset,
            })

            return {
                success: result.success,
                focusTask: result.focusTask,
                wasNewTaskSet: result.wasNewTaskSet,
                message: result.message,
            }
        }

        case 'update_task': {
            const updateTaskPatchVersion = '2026-02-12-project-move-support-v4'
            console.log('📝 UPDATE_TASK TOOL: Starting task update', {
                creatorId,
                projectId,
                toolArgs,
                isBulkUpdate: toolArgs.updateAll || false,
                patchVersion: updateTaskPatchVersion,
            })

            const db = admin.firestore()

            // Initialize TaskUpdateService if not already done
            if (!this.taskUpdateService) {
                const TaskUpdateService = require('../shared/TaskUpdateService')
                const moment = require('moment-timezone')
                this.taskUpdateService = new TaskUpdateService({
                    database: db,
                    moment: moment,
                    isCloudFunction: true,
                })
                await this.taskUpdateService.initialize()
            }

            // Use shared service for find and update
            // toolArgs contains: taskId, taskName, projectId, projectName, completed, focus, name, description, dueDate, alertEnabled, estimation, updateAll
            try {
                const normalizedToolArgs = { ...toolArgs }
                const moveToProjectId =
                    typeof normalizedToolArgs.moveToProjectId === 'string'
                        ? normalizedToolArgs.moveToProjectId.trim()
                        : ''
                const moveToProjectName =
                    typeof normalizedToolArgs.moveToProjectName === 'string'
                        ? normalizedToolArgs.moveToProjectName.trim()
                        : ''
                const hasMoveRequest = !!(moveToProjectId || moveToProjectName)

                // Never pass move fields into TaskUpdateService update payload.
                delete normalizedToolArgs.moveToProjectId
                delete normalizedToolArgs.moveToProjectName

                // Reconcile project selection for update_task:
                // - model-provided projectId can be stale/hallucinated
                // - when projectName is present, validate/resolve against user's real projects
                const hasProjectConstraint = !!(normalizedToolArgs.projectId || normalizedToolArgs.projectName)
                if (hasProjectConstraint) {
                    try {
                        const { ProjectService } = require('../shared/ProjectService')
                        const projectService = new ProjectService({ database: db })
                        await projectService.initialize()

                        const projects = await projectService.getUserProjects(creatorId, {
                            includeArchived: true,
                            includeCommunity: true,
                            activeOnly: false,
                        })
                        const projectsById = new Map(projects.map(p => [p.id, p]))
                        const contextProject = projectId ? projectsById.get(projectId) : null
                        const contextNameLower = (contextProject?.name || '').toLowerCase()

                        const requestedProjectName =
                            typeof normalizedToolArgs.projectName === 'string'
                                ? normalizedToolArgs.projectName.trim()
                                : normalizedToolArgs.projectName
                        const requestedProjectNameLower =
                            typeof requestedProjectName === 'string' ? requestedProjectName.toLowerCase() : null

                        const stringMatch = (a, b) => !!a && !!b && (a === b || a.includes(b) || b.includes(a))

                        let resolvedProjectId = null
                        let resolutionSource = 'none'

                        // 1) Validate explicit projectId if provided
                        if (normalizedToolArgs.projectId && projectsById.has(normalizedToolArgs.projectId)) {
                            const projectFromId = projectsById.get(normalizedToolArgs.projectId)
                            const idNameLower = (projectFromId?.name || '').toLowerCase()
                            const idMatchesName = requestedProjectNameLower
                                ? stringMatch(idNameLower, requestedProjectNameLower)
                                : true
                            const contextNameMatchesRequested = requestedProjectNameLower
                                ? stringMatch(contextNameLower, requestedProjectNameLower)
                                : false
                            const shouldPreferContextProject =
                                contextProject &&
                                requestedProjectNameLower &&
                                contextNameMatchesRequested &&
                                contextProject.id !== normalizedToolArgs.projectId

                            if (shouldPreferContextProject) {
                                resolvedProjectId = contextProject.id
                                resolutionSource = 'context_preferred_over_toolArgs.projectId'
                                console.warn(
                                    '📝 UPDATE_TASK TOOL: Preferring context project over conflicting tool projectId',
                                    {
                                        contextProjectId: contextProject.id,
                                        contextProjectName: contextProject.name,
                                        toolArgsProjectId: normalizedToolArgs.projectId,
                                        toolArgsProjectName: requestedProjectName,
                                        toolProjectName: projectFromId?.name,
                                    }
                                )
                            } else if (idMatchesName) {
                                resolvedProjectId = normalizedToolArgs.projectId
                                resolutionSource = 'validated_toolArgs.projectId'
                            } else {
                                console.warn('📝 UPDATE_TASK TOOL: Ignoring mismatched projectId/projectName', {
                                    toolArgsProjectId: normalizedToolArgs.projectId,
                                    toolArgsProjectName: requestedProjectName,
                                    projectNameForId: projectFromId?.name,
                                })
                            }
                        } else if (normalizedToolArgs.projectId) {
                            console.warn('📝 UPDATE_TASK TOOL: Ignoring unknown/inaccessible projectId', {
                                toolArgsProjectId: normalizedToolArgs.projectId,
                            })
                        }

                        // 2) If unresolved and projectName provided, prefer chat context if it name-matches
                        if (!resolvedProjectId && requestedProjectNameLower) {
                            if (contextProject && stringMatch(contextNameLower, requestedProjectNameLower)) {
                                resolvedProjectId = contextProject.id
                                resolutionSource = 'context_project_name_match'
                            } else {
                                const exact = projects.find(
                                    p => (p.name || '').toLowerCase() === requestedProjectNameLower
                                )
                                const partial = projects.find(p =>
                                    (p.name || '').toLowerCase().includes(requestedProjectNameLower)
                                )
                                const byName = exact || partial
                                if (byName) {
                                    resolvedProjectId = byName.id
                                    resolutionSource = exact
                                        ? 'resolved_projectName_exact'
                                        : 'resolved_projectName_partial'
                                }
                            }
                        }

                        if (resolvedProjectId) {
                            normalizedToolArgs.projectId = resolvedProjectId
                        } else if (normalizedToolArgs.projectId) {
                            // prevent hard-failing on a bad model-supplied projectId
                            delete normalizedToolArgs.projectId
                        }

                        if (typeof requestedProjectName === 'string') {
                            normalizedToolArgs.projectName = requestedProjectName
                        }

                        console.log('📝 UPDATE_TASK TOOL: Project selection', {
                            contextProjectId: projectId,
                            toolArgsProjectId: toolArgs.projectId,
                            toolArgsProjectName: toolArgs.projectName,
                            selectedProjectId: normalizedToolArgs.projectId || null,
                            source: resolutionSource,
                        })
                    } catch (projectResolutionError) {
                        console.warn('📝 UPDATE_TASK TOOL: Project resolution failed, using original tool args', {
                            error: projectResolutionError.message,
                        })
                    }
                }

                const result = await this.taskUpdateService.findAndUpdateTask(
                    creatorId,
                    normalizedToolArgs, // searchCriteria (includes projectId for filtering)
                    normalizedToolArgs, // updateFields (includes estimation, completed, focus, etc.)
                    {
                        autoSelectOnHighConfidence: true,
                        highConfidenceThreshold: 800,
                        dominanceMargin: 300,
                        maxOptionsToShow: 5,
                        updateAll: toolArgs.updateAll || false, // Enable bulk update if requested
                    }
                )

                console.log('📝 UPDATE_TASK TOOL: Result', {
                    success: result.success,
                    message: result.message,
                    isBulkUpdate: !!result.updated,
                    tasksUpdated: Array.isArray(result.updated) ? result.updated.length : result.success ? 1 : 0,
                })

                if (hasMoveRequest && result.success && toolArgs.updateAll) {
                    const targetProject = await resolveMoveTargetProject(
                        db,
                        creatorId,
                        moveToProjectId,
                        moveToProjectName
                    )
                    const editorName =
                        (userContext && (userContext.displayName || userContext.name || userContext.userName)) || null
                    const updatedTasks = Array.isArray(result.updated) ? result.updated.map(task => ({ ...task })) : []

                    const moveSummary = {
                        attempted: updatedTasks.length,
                        moved: [],
                        skipped: [],
                        failed: [],
                    }

                    for (const task of updatedTasks) {
                        const taskId = task?.id
                        const sourceProjectId = task?.projectId || normalizedToolArgs.projectId || projectId || null
                        const sourceProjectName = task?.projectName || null

                        if (!taskId || !sourceProjectId) {
                            const missingDataError = 'Could not determine source project for task move.'
                            moveSummary.failed.push({
                                taskId: taskId || null,
                                sourceProjectId: sourceProjectId || null,
                                sourceProjectName,
                                error: missingDataError,
                            })
                            task.move = {
                                moved: false,
                                error: missingDataError,
                            }
                            continue
                        }

                        if (targetProject.id === sourceProjectId) {
                            const skippedMove = {
                                moved: false,
                                reason: 'already_in_target_project',
                                sourceProjectId,
                                targetProjectId: targetProject.id,
                                taskId,
                            }
                            moveSummary.skipped.push({
                                taskId,
                                sourceProjectId,
                                sourceProjectName,
                                targetProjectId: targetProject.id,
                                targetProjectName: targetProject.name,
                                reason: skippedMove.reason,
                            })
                            task.move = skippedMove
                            task.projectId = targetProject.id
                            task.projectName = targetProject.name
                            if (Array.isArray(task.changes)) {
                                task.changes = [...task.changes, `already in project "${targetProject.name}"`]
                            }
                            continue
                        }

                        try {
                            const moveResult = await moveTaskToDifferentProject({
                                database: db,
                                sourceProjectId,
                                targetProjectId: targetProject.id,
                                taskId,
                                editorId: creatorId,
                                editorName,
                            })

                            moveSummary.moved.push({
                                taskId,
                                sourceProjectId,
                                sourceProjectName,
                                targetProjectId: targetProject.id,
                                targetProjectName: targetProject.name,
                                movedTaskCount: moveResult?.movedTaskCount || 1,
                            })

                            task.move = moveResult
                            task.projectId = targetProject.id
                            task.projectName = targetProject.name
                            if (Array.isArray(task.changes)) {
                                task.changes = [...task.changes, `moved to project "${targetProject.name}"`]
                            } else {
                                task.changes = [`moved to project "${targetProject.name}"`]
                            }
                        } catch (moveError) {
                            moveSummary.failed.push({
                                taskId,
                                sourceProjectId,
                                sourceProjectName,
                                targetProjectId: targetProject.id,
                                targetProjectName: targetProject.name,
                                error: moveError.message,
                            })
                            task.move = {
                                moved: false,
                                error: moveError.message,
                            }
                        }
                    }

                    const moveSummaryText =
                        `Move results: ${moveSummary.moved.length} moved` +
                        (moveSummary.skipped.length > 0 ? `, ${moveSummary.skipped.length} already in target` : '') +
                        (moveSummary.failed.length > 0 ? `, ${moveSummary.failed.length} failed` : '') +
                        `.`

                    return {
                        ...result,
                        updated: updatedTasks,
                        move: {
                            targetProjectId: targetProject.id,
                            targetProjectName: targetProject.name,
                            ...moveSummary,
                        },
                        message: `${result.message}. ${moveSummaryText}`,
                    }
                }

                if (hasMoveRequest && result.success && !toolArgs.updateAll) {
                    const sourceProjectId =
                        (result.project && result.project.id) || normalizedToolArgs.projectId || projectId || null
                    const sourceProjectName = (result.project && result.project.name) || null

                    if (!sourceProjectId) {
                        throw new Error('Could not determine source project for task move.')
                    }

                    const targetProject = await resolveMoveTargetProject(
                        db,
                        creatorId,
                        moveToProjectId,
                        moveToProjectName
                    )
                    const editorName =
                        (userContext && (userContext.displayName || userContext.name || userContext.userName)) || null

                    if (targetProject.id === sourceProjectId) {
                        return {
                            ...result,
                            move: {
                                moved: false,
                                reason: 'already_in_target_project',
                                sourceProjectId,
                                targetProjectId: targetProject.id,
                            },
                            message: `${result.message}. Task is already in project "${targetProject.name}".`,
                        }
                    }

                    const moveResult = await moveTaskToDifferentProject({
                        database: db,
                        sourceProjectId,
                        targetProjectId: targetProject.id,
                        taskId: result.taskId,
                        editorId: creatorId,
                        editorName,
                    })

                    console.log('📝 UPDATE_TASK TOOL: Move completed', {
                        taskId: result.taskId,
                        sourceProjectId,
                        sourceProjectName,
                        targetProjectId: targetProject.id,
                        targetProjectName: targetProject.name,
                        moveResult,
                    })

                    const nextChanges = Array.isArray(result.changes) ? [...result.changes] : []
                    nextChanges.push(`moved to project "${targetProject.name}"`)

                    return {
                        ...result,
                        project: {
                            id: targetProject.id,
                            name: targetProject.name,
                        },
                        changes: nextChanges,
                        move: moveResult,
                        message: `${result.message}. Moved task to project "${targetProject.name}".`,
                    }
                }

                return result
            } catch (error) {
                console.error('📝 UPDATE_TASK TOOL: Task update failed', {
                    error: error.message,
                    stack: error.stack,
                })
                throw error
            }
        }

        case 'update_note': {
            const { NoteService } = require('../shared/NoteService')
            const { SearchService } = require('../shared/SearchService')
            const { UserHelper } = require('../shared/UserHelper')
            const db = admin.firestore()
            const moveToProjectId = typeof toolArgs.moveToProjectId === 'string' ? toolArgs.moveToProjectId.trim() : ''
            const moveToProjectName =
                typeof toolArgs.moveToProjectName === 'string' ? toolArgs.moveToProjectName.trim() : ''
            const hasMoveRequest = !!(moveToProjectId || moveToProjectName)
            const hasContentUpdate = toolArgs.content !== undefined
            const hasTitleUpdate = toolArgs.title !== undefined

            // Initialize or reuse SearchService instance (performance optimization)
            if (!cachedSearchService) {
                let storageBucket = null
                try {
                    const adminProjectId = admin.app && admin.app().options && admin.app().options.projectId
                    const gcpProject = process.env.GCP_PROJECT
                    const gcloudProject = process.env.GCLOUD_PROJECT

                    if (
                        adminProjectId === 'alldonealeph' ||
                        gcpProject === 'alldonealeph' ||
                        gcloudProject === 'alldonealeph'
                    ) {
                        storageBucket = 'notescontentprod'
                    } else if (
                        adminProjectId === 'alldonestaging' ||
                        gcpProject === 'alldonestaging' ||
                        gcloudProject === 'alldonestaging'
                    ) {
                        storageBucket = 'notescontentstaging'
                    }

                    if (storageBucket)
                        console.log(
                            'Internal Assistant: Explicitly setting storage bucket for SearchService:',
                            storageBucket
                        )
                } catch (e) {
                    console.warn('Internal Assistant: Failed to determine storage bucket for SearchService', e)
                }

                cachedSearchService = new SearchService({
                    database: db,
                    moment: moment,
                    enableAlgolia: true,
                    enableNoteContent: true,
                    enableDateParsing: true,
                    isCloudFunction: true,
                    storageBucket: storageBucket,
                })
                await cachedSearchService.initialize()
            }

            // Step 1: Note Discovery - get final result from SearchService
            let searchResult = await cachedSearchService.findNoteForUpdateWithResults(
                creatorId,
                {
                    noteTitle: toolArgs.noteTitle,
                    noteId: toolArgs.noteId, // Optional direct lookup
                    projectName: toolArgs.projectName, // Optional project filter
                    projectId: toolArgs.projectId || (toolArgs.projectName ? undefined : projectId), // Use explicit source project if provided, otherwise current context project when no projectName is given
                },
                {
                    // Tune confidence for internal assistant to be more aggressive
                    highConfidenceThreshold: 600, // Lower from default 800
                    dominanceMargin: 200, // Lower from default 300
                }
            )

            // Handle search failure - match MCP behavior
            if (!searchResult.success) {
                if (searchResult.error === 'NO_MATCHES') {
                    throw new Error(searchResult.message)
                } else if (searchResult.error === 'MULTIPLE_MATCHES') {
                    // Return match info to LLM instead of throwing (MCP pattern)
                    return {
                        success: false,
                        message: searchResult.message,
                        confidence: searchResult.confidence,
                        reasoning: searchResult.reasoning,
                        matches: searchResult.matches,
                        totalMatches: searchResult.totalMatches,
                    }
                } else {
                    throw new Error(searchResult.message)
                }
            }

            // Step 2: Note Update - proceed with selected note
            const currentNote = searchResult.selectedNote
            const currentProjectId = searchResult.projectId
            const currentProjectName = searchResult.projectName

            if (!hasContentUpdate && !hasTitleUpdate && !hasMoveRequest) {
                throw new Error(
                    'No note changes requested. Provide content, title, moveToProjectId, or moveToProjectName.'
                )
            }

            // Get user data for feed creation using shared helper
            const feedUser = await UserHelper.getFeedUserData(db, creatorId)

            // Initialize or reuse NoteService instance (performance optimization)
            if (!cachedNoteService) {
                let storageBucket = null
                try {
                    // Explicitly detect bucket from admin app to avoid detection failures in NoteService
                    const adminProjectId = admin.app && admin.app().options && admin.app().options.projectId
                    const gcpProject = process.env.GCP_PROJECT
                    const gcloudProject = process.env.GCLOUD_PROJECT

                    if (
                        adminProjectId === 'alldonealeph' ||
                        gcpProject === 'alldonealeph' ||
                        gcloudProject === 'alldonealeph'
                    ) {
                        storageBucket = 'notescontentprod'
                    } else if (
                        adminProjectId === 'alldonestaging' ||
                        gcpProject === 'alldonestaging' ||
                        gcloudProject === 'alldonestaging'
                    ) {
                        storageBucket = 'notescontentstaging'
                    }

                    // Default/Dev will handle itself or fall back in NoteService
                    if (storageBucket)
                        console.log('Internal Assistant: Explicitly setting storage bucket:', storageBucket)
                } catch (e) {
                    console.warn('Internal Assistant: Failed to determine storage bucket from admin app', e)
                }

                cachedNoteService = new NoteService({
                    database: db,
                    moment: moment,
                    idGenerator: () => db.collection('_').doc().id,
                    enableFeeds: true,
                    enableValidation: false, // Skip validation since we already validated
                    isCloudFunction: true,
                    storageBucket: storageBucket,
                })
                await cachedNoteService.initialize()
            }

            try {
                let result = {
                    success: true,
                    noteId: currentNote.id,
                    updatedNote: { id: currentNote.id, ...currentNote },
                    changes: [],
                }

                if (hasContentUpdate || hasTitleUpdate) {
                    console.log('Internal Assistant: Using NoteService for note update with feed generation')
                    result = await cachedNoteService.updateAndPersistNote({
                        noteId: currentNote.id,
                        projectId: currentProjectId,
                        currentNote: currentNote,
                        content: toolArgs.content,
                        title: toolArgs.title, // Optional: for renaming the note
                        feedUser: feedUser,
                    })

                    console.log('Note updated via NoteService:', {
                        noteId: currentNote.id,
                        projectId: currentProjectId,
                        changes: result.changes,
                        feedGenerated: !!result.feedData,
                        persisted: result.persisted,
                    })
                }

                let finalProjectId = currentProjectId
                let finalProjectName = currentProjectName
                const changes = Array.isArray(result.changes) ? [...result.changes] : []
                let moveResult = null

                if (hasMoveRequest) {
                    const targetProject = await resolveMoveTargetProject(
                        db,
                        creatorId,
                        moveToProjectId,
                        moveToProjectName
                    )
                    if (targetProject.id !== currentProjectId) {
                        let notesBucketName = null
                        try {
                            notesBucketName =
                                cachedNoteService && cachedNoteService.getBucketName
                                    ? await cachedNoteService.getBucketName()
                                    : null
                        } catch (bucketError) {
                            console.warn('Internal Assistant: Failed to resolve notes bucket for move', bucketError)
                        }

                        const editorName = feedUser && (feedUser.displayName || feedUser.name)
                        moveResult = await moveNoteToDifferentProject({
                            database: db,
                            sourceProjectId: currentProjectId,
                            targetProjectId: targetProject.id,
                            noteId: currentNote.id,
                            editorId: creatorId,
                            editorName: editorName || null,
                            notesBucketName,
                        })
                        finalProjectId = targetProject.id
                        finalProjectName = targetProject.name
                        changes.push(`moved to project "${targetProject.name}"`)
                    } else {
                        moveResult = {
                            moved: false,
                            reason: 'already_in_target_project',
                            sourceProjectId: currentProjectId,
                            targetProjectId: targetProject.id,
                            noteId: currentNote.id,
                        }
                    }
                }

                let fullContent = ''
                try {
                    fullContent = await cachedNoteService.getStorageContent(finalProjectId, currentNote.id)
                    console.log('Internal Assistant: Fetched full content for summary:', fullContent.length)
                } catch (contentError) {
                    console.warn('Internal Assistant: Failed to fetch full content:', contentError.message)
                    fullContent = toolArgs.content || ''
                }

                let finalNote = result.updatedNote || { id: currentNote.id, ...currentNote }
                try {
                    const finalNoteDoc = await db.doc(`noteItems/${finalProjectId}/notes/${currentNote.id}`).get()
                    if (finalNoteDoc.exists) {
                        finalNote = { id: currentNote.id, ...finalNoteDoc.data() }
                    }
                } catch (noteFetchError) {
                    console.warn('Internal Assistant: Failed to fetch final note metadata', noteFetchError)
                }

                let message = `Note "${currentNote.title || 'Untitled'}" updated successfully`
                if (!hasContentUpdate && !hasTitleUpdate && hasMoveRequest) {
                    message = `Note "${currentNote.title || 'Untitled'}" moved successfully`
                }
                if (changes.length > 0) {
                    message += ` (${changes.join(', ')})`
                }
                message += ` in project "${finalProjectName}"`

                if (toolArgs.content) {
                    message += `.\n\nContent added:\n"${toolArgs.content}"`
                }

                if (searchResult.isAutoSelected) {
                    message += ` (${searchResult.reasoning})`
                }

                return {
                    success: true,
                    noteId: currentNote.id,
                    message,
                    note: {
                        ...finalNote,
                        content: fullContent,
                    },
                    project: { id: finalProjectId, name: finalProjectName },
                    changes: changes,
                    move: moveResult,
                }
            } catch (error) {
                console.error('NoteService update failed:', error)
                throw new Error(`Failed to update note: ${error.message}`)
            }
        }

        case 'update_user_memory': {
            const db = admin.firestore()

            return await updateUserMemory({
                db,
                projectId,
                requestUserId,
                fact: toolArgs.fact,
                category: toolArgs.category,
                reason: toolArgs.reason,
            })
        }

        case 'search': {
            // Only use projectId if explicitly provided by the LLM in toolArgs
            // Do NOT default to current project - this allows searching across all user's projects
            const searchProjectId = toolArgs.projectId || null

            console.log('🔍 SEARCH TOOL: Starting search execution', {
                creatorId,
                query: toolArgs.query,
                type: toolArgs.type || 'all',
                projectId: searchProjectId,
                currentProjectId: projectId,
                dateRange: toolArgs.dateRange || null,
                status: toolArgs.status || null,
                limit: toolArgs.limit || null,
            })

            const { SearchService } = require('../shared/SearchService')
            const moment = require('moment')

            // Initialize SearchService with full capabilities
            const searchService = new SearchService({
                database: admin.firestore(),
                moment: moment,
                enableAlgolia: true,
                enableNoteContent: true,
                enableDateParsing: true,
                isCloudFunction: true,
            })
            await searchService.initialize()
            console.log('🔍 SEARCH TOOL: SearchService initialized')

            // Execute search - pass null projectId to search across all user's accessible projects
            const result = await searchService.search(creatorId, {
                query: toolArgs.query,
                type: toolArgs.type || 'all',
                projectId: searchProjectId,
                dateRange: toolArgs.dateRange || null,
                status: toolArgs.status || null,
                limit: toolArgs.limit || undefined,
            })
            console.log('🔍 SEARCH TOOL: Search completed', {
                tasksCount: result.results.tasks?.length || 0,
                notesCount: result.results.notes?.length || 0,
                goalsCount: result.results.goals?.length || 0,
                contactsCount: result.results.contacts?.length || 0,
                chatsCount: result.results.chats?.length || 0,
                assistantsCount: result.results.assistants?.length || 0,
            })

            // Format results for assistant
            const summary = []
            let totalResults = 0

            if (result.results.tasks && result.results.tasks.length > 0) {
                summary.push(`${result.results.tasks.length} tasks`)
                totalResults += result.results.tasks.length
            }
            if (result.results.notes && result.results.notes.length > 0) {
                summary.push(`${result.results.notes.length} notes`)
                totalResults += result.results.notes.length
            }
            if (result.results.goals && result.results.goals.length > 0) {
                summary.push(`${result.results.goals.length} goals`)
                totalResults += result.results.goals.length
            }
            if (result.results.contacts && result.results.contacts.length > 0) {
                summary.push(`${result.results.contacts.length} contacts`)
                totalResults += result.results.contacts.length
            }
            if (result.results.chats && result.results.chats.length > 0) {
                summary.push(`${result.results.chats.length} chats`)
                totalResults += result.results.chats.length
            }
            if (result.results.assistants && result.results.assistants.length > 0) {
                summary.push(`${result.results.assistants.length} assistants`)
                totalResults += result.results.assistants.length
            }

            const searchResult = {
                success: true,
                query: result.query,
                results: result.results,
                totalResults: totalResults,
                summary: totalResults > 0 ? `Found ${summary.join(', ')}` : 'No results found',
                searchedProjects: result.searchedProjects || [],
            }

            console.log('🔍 SEARCH TOOL: Returning result', {
                success: searchResult.success,
                totalResults: searchResult.totalResults,
                summary: searchResult.summary,
                resultLength: JSON.stringify(searchResult).length,
            })

            return searchResult
        }

        case 'get_note': {
            console.log('📝 GET_NOTE TOOL: Starting note retrieval', {
                creatorId,
                noteId: toolArgs.noteId,
                projectId: toolArgs.projectId,
            })

            const { SearchService } = require('../shared/SearchService')
            const moment = require('moment')

            // Initialize SearchService for note retrieval
            let storageBucket = null
            try {
                const projectId = admin.app().options.projectId
                if (projectId === 'alldonealeph') storageBucket = 'notescontentprod'
                else if (projectId === 'alldonestaging') storageBucket = 'notescontentstaging'
            } catch (e) {}

            const searchService = new SearchService({
                database: admin.firestore(),
                moment: moment,
                enableAlgolia: true,
                enableNoteContent: true,
                enableDateParsing: true,
                isCloudFunction: true,
                storageBucket: storageBucket,
            })
            await searchService.initialize()
            console.log('📝 GET_NOTE TOOL: SearchService initialized')

            // Retrieve full note content
            const note = await searchService.getNote(creatorId, toolArgs.noteId, toolArgs.projectId)
            console.log('📝 GET_NOTE TOOL: Note retrieved', {
                noteId: note.id,
                title: note.title,
                contentLength: note.content?.length || 0,
                contentPreview: note.content?.substring(0, 200),
                projectId: note.projectId,
                projectName: note.projectName,
                wordCount: note.metadata?.wordCount || 0,
            })

            const result = {
                success: true,
                note: {
                    id: note.id,
                    title: note.title,
                    content: note.content,
                    projectId: note.projectId,
                    projectName: note.projectName,
                    createdAt: note.createdAt,
                    updatedAt: note.updatedAt,
                    wordCount: note.metadata?.wordCount || 0,
                },
            }

            console.log('📝 GET_NOTE TOOL: Returning result', {
                success: result.success,
                resultLength: JSON.stringify(result).length,
            })

            return result
        }

        case 'web_search': {
            console.log('🌐 WEB_SEARCH TOOL: Starting internet search', {
                query: toolArgs.query,
                search_depth: toolArgs.search_depth,
            })

            const envFunctions = getCachedEnvFunctions()
            const tavilyApiKey = envFunctions.TAVILY_API_KEY

            if (!tavilyApiKey || tavilyApiKey === '' || tavilyApiKey.startsWith('your_')) {
                return {
                    success: false,
                    error: 'Web search is not configured. TAVILY_API_KEY is missing.',
                }
            }

            try {
                const { tavily } = require('@tavily/core')
                const tvly = tavily({ apiKey: tavilyApiKey })

                const searchDepth = toolArgs.search_depth || 'basic'
                const response = await tvly.search(toolArgs.query, {
                    searchDepth: searchDepth,
                    maxResults: 5,
                    includeAnswer: true,
                })

                console.log('🌐 WEB_SEARCH TOOL: Search completed', {
                    query: toolArgs.query,
                    resultCount: response.results?.length || 0,
                    hasAnswer: !!response.answer,
                })

                const results = (response.results || []).map(r => ({
                    title: r.title,
                    url: r.url,
                    content: r.content,
                }))

                return {
                    success: true,
                    answer: response.answer || null,
                    results: results,
                    query: toolArgs.query,
                }
            } catch (error) {
                console.error('🌐 WEB_SEARCH TOOL: Search failed', {
                    error: error.message,
                    query: toolArgs.query,
                })
                return {
                    success: false,
                    error: `Web search failed: ${error.message}`,
                    query: toolArgs.query,
                }
            }
        }

        case 'search_gmail': {
            console.log('📧 SEARCH_GMAIL TOOL: Starting Gmail search', {
                query: toolArgs.query,
                limit: toolArgs.limit,
                includeBodies: toolArgs.includeBodies,
                requestUserId: requestUserId || null,
            })

            const targetUserId = requestUserId || creatorId
            if (!targetUserId) {
                return {
                    success: false,
                    query: typeof toolArgs.query === 'string' ? toolArgs.query : '',
                    searchedAccounts: [],
                    accountsWithErrors: [],
                    partialFailure: false,
                    results: [],
                    message: 'Gmail search requires a valid requesting user.',
                }
            }

            try {
                const { searchGmailForAssistantRequest } = require('../Gmail/assistantGmailSearch')
                const result = await searchGmailForAssistantRequest({
                    userId: targetUserId,
                    query: toolArgs.query,
                    limit: toolArgs.limit,
                    includeBodies: toolArgs.includeBodies,
                })

                console.log('📧 SEARCH_GMAIL TOOL: Search completed', {
                    success: result.success,
                    query: toolArgs.query,
                    searchedAccounts: result.searchedAccounts?.length || 0,
                    accountsWithErrors: result.accountsWithErrors?.length || 0,
                    resultCount: result.results?.length || 0,
                    partialFailure: !!result.partialFailure,
                })

                return result
            } catch (error) {
                console.error('📧 SEARCH_GMAIL TOOL: Search failed', {
                    error: error.message,
                    query: toolArgs.query,
                    requestUserId: targetUserId,
                })
                return {
                    success: false,
                    query: typeof toolArgs.query === 'string' ? toolArgs.query : '',
                    searchedAccounts: [],
                    accountsWithErrors: [],
                    partialFailure: false,
                    results: [],
                    message: `Gmail search failed: ${error.message}`,
                }
            }
        }

        case 'create_gmail_reply_draft': {
            console.log('📧 CREATE_GMAIL_REPLY_DRAFT TOOL: Starting Gmail reply draft creation', {
                query: toolArgs.query,
                messageId: toolArgs.messageId,
                threadId: toolArgs.threadId,
                requestUserId: requestUserId || null,
            })

            const targetUserId = requestUserId || creatorId
            if (!targetUserId) {
                return {
                    success: false,
                    message: 'Gmail reply draft creation requires a valid requesting user.',
                }
            }

            try {
                const { createGmailReplyDraftForAssistantRequest } = require('../Gmail/assistantGmailDrafts')
                const result = await createGmailReplyDraftForAssistantRequest({
                    userId: targetUserId,
                    query: toolArgs.query,
                    messageId: toolArgs.messageId,
                    threadId: toolArgs.threadId,
                    body: toolArgs.body,
                    instructions: toolArgs.instructions,
                })

                console.log('📧 CREATE_GMAIL_REPLY_DRAFT TOOL: Completed', {
                    success: result.success,
                    gmailEmail: result.gmailEmail || null,
                    draftId: result.draftId || null,
                    threadId: result.threadId || null,
                })

                return result
            } catch (error) {
                console.error('📧 CREATE_GMAIL_REPLY_DRAFT TOOL: Failed', {
                    error: error.message,
                    requestUserId: targetUserId,
                    query: toolArgs.query,
                    messageId: toolArgs.messageId,
                    threadId: toolArgs.threadId,
                })
                return {
                    success: false,
                    message: `Gmail reply draft creation failed: ${error.message}`,
                }
            }
        }

        case 'create_gmail_draft': {
            console.log('📧 CREATE_GMAIL_DRAFT TOOL: Starting Gmail draft creation', {
                subject: toolArgs.subject,
                requestUserId: requestUserId || null,
                projectId: projectId || null,
            })

            const targetUserId = requestUserId || creatorId
            if (!targetUserId) {
                return {
                    success: false,
                    message: 'Gmail draft creation requires a valid requesting user.',
                }
            }

            if (!projectId) {
                return {
                    success: false,
                    message: 'Gmail draft creation requires a current project context.',
                }
            }

            try {
                const { createGmailDraftForAssistantRequest } = require('../Gmail/assistantGmailDrafts')
                const result = await createGmailDraftForAssistantRequest({
                    userId: targetUserId,
                    projectId,
                    to: toolArgs.to,
                    cc: toolArgs.cc,
                    bcc: toolArgs.bcc,
                    subject: toolArgs.subject,
                    body: toolArgs.body,
                })

                console.log('📧 CREATE_GMAIL_DRAFT TOOL: Completed', {
                    success: result.success,
                    gmailEmail: result.gmailEmail || null,
                    draftId: result.draftId || null,
                    threadId: result.threadId || null,
                })

                return result
            } catch (error) {
                console.error('📧 CREATE_GMAIL_DRAFT TOOL: Failed', {
                    error: error.message,
                    requestUserId: targetUserId,
                    projectId: projectId || null,
                    subject: toolArgs.subject,
                })
                return {
                    success: false,
                    message: `Gmail draft creation failed: ${error.message}`,
                }
            }
        }

        case 'update_gmail_draft': {
            console.log('📧 UPDATE_GMAIL_DRAFT TOOL: Starting Gmail draft update', {
                draftId: toolArgs.draftId,
                requestUserId: requestUserId || null,
            })

            const targetUserId = requestUserId || creatorId
            if (!targetUserId) {
                return {
                    success: false,
                    message: 'Gmail draft update requires a valid requesting user.',
                }
            }

            try {
                const { updateGmailDraftForAssistantRequest } = require('../Gmail/assistantGmailDrafts')
                const result = await updateGmailDraftForAssistantRequest({
                    userId: targetUserId,
                    draftId: toolArgs.draftId,
                    to: toolArgs.to,
                    cc: toolArgs.cc,
                    bcc: toolArgs.bcc,
                    subject: toolArgs.subject,
                    body: toolArgs.body,
                })

                console.log('📧 UPDATE_GMAIL_DRAFT TOOL: Completed', {
                    success: result.success,
                    gmailEmail: result.gmailEmail || null,
                    draftId: result.draftId || null,
                    threadId: result.threadId || null,
                })

                return result
            } catch (error) {
                console.error('📧 UPDATE_GMAIL_DRAFT TOOL: Failed', {
                    error: error.message,
                    requestUserId: targetUserId,
                    draftId: toolArgs.draftId,
                })
                return {
                    success: false,
                    message: `Gmail draft update failed: ${error.message}`,
                }
            }
        }

        case 'search_calendar_events': {
            console.log('📅 SEARCH_CALENDAR_EVENTS TOOL: Starting Calendar search', {
                query: toolArgs.query,
                timeMin: toolArgs.timeMin,
                timeMax: toolArgs.timeMax,
                calendarId: toolArgs.calendarId,
                limit: toolArgs.limit,
                requestUserId: requestUserId || null,
            })

            const targetUserId = requestUserId || creatorId
            if (!targetUserId) {
                return {
                    success: false,
                    query: typeof toolArgs.query === 'string' ? toolArgs.query : '',
                    searchedAccounts: [],
                    accountsWithErrors: [],
                    partialFailure: false,
                    results: [],
                    message: 'Calendar search requires a valid requesting user.',
                }
            }

            try {
                const { searchCalendarEventsForAssistantRequest } = require('../GoogleCalendar/assistantCalendarTools')
                const result = await searchCalendarEventsForAssistantRequest({
                    userId: targetUserId,
                    query: toolArgs.query,
                    timeMin: toolArgs.timeMin,
                    timeMax: toolArgs.timeMax,
                    calendarId: toolArgs.calendarId,
                    limit: toolArgs.limit,
                    includeDescription: toolArgs.includeDescription,
                })

                console.log('📅 SEARCH_CALENDAR_EVENTS TOOL: Search completed', {
                    success: result.success,
                    query: toolArgs.query,
                    searchedAccounts: result.searchedAccounts?.length || 0,
                    accountsWithErrors: result.accountsWithErrors?.length || 0,
                    resultCount: result.results?.length || 0,
                    partialFailure: !!result.partialFailure,
                })

                return result
            } catch (error) {
                console.error('📅 SEARCH_CALENDAR_EVENTS TOOL: Search failed', {
                    error: error.message,
                    query: toolArgs.query,
                    requestUserId: targetUserId,
                })
                return {
                    success: false,
                    query: typeof toolArgs.query === 'string' ? toolArgs.query : '',
                    searchedAccounts: [],
                    accountsWithErrors: [],
                    partialFailure: false,
                    results: [],
                    message: `Calendar search failed: ${error.message}`,
                }
            }
        }

        case 'create_calendar_event': {
            console.log('📅 CREATE_CALENDAR_EVENT TOOL: Starting Calendar create', {
                summary: toolArgs.summary,
                calendarId: toolArgs.calendarId,
                requestUserId: requestUserId || null,
            })

            const targetUserId = requestUserId || creatorId
            if (!targetUserId) {
                return {
                    success: false,
                    message: 'Calendar event creation requires a valid requesting user.',
                }
            }

            try {
                const { createCalendarEventForAssistantRequest } = require('../GoogleCalendar/assistantCalendarTools')
                const result = await createCalendarEventForAssistantRequest({
                    userId: targetUserId,
                    summary: toolArgs.summary,
                    description: toolArgs.description,
                    start: toolArgs.start,
                    end: toolArgs.end,
                    timeZone: toolArgs.timeZone,
                    location: toolArgs.location,
                    attendees: toolArgs.attendees,
                    calendarId: toolArgs.calendarId,
                })

                console.log('📅 CREATE_CALENDAR_EVENT TOOL: Create completed', {
                    success: result.success,
                    calendarId: result.calendarId || toolArgs.calendarId || null,
                    eventId: result.event?.eventId || null,
                })

                return result
            } catch (error) {
                console.error('📅 CREATE_CALENDAR_EVENT TOOL: Create failed', {
                    error: error.message,
                    summary: toolArgs.summary,
                    requestUserId: targetUserId,
                })
                return {
                    success: false,
                    message: `Calendar event creation failed: ${error.message}`,
                }
            }
        }

        case 'update_calendar_event': {
            console.log('📅 UPDATE_CALENDAR_EVENT TOOL: Starting Calendar update', {
                eventId: toolArgs.eventId,
                calendarId: toolArgs.calendarId,
                requestUserId: requestUserId || null,
            })

            const targetUserId = requestUserId || creatorId
            if (!targetUserId) {
                return {
                    success: false,
                    message: 'Calendar event update requires a valid requesting user.',
                }
            }

            try {
                const { updateCalendarEventForAssistantRequest } = require('../GoogleCalendar/assistantCalendarTools')
                const result = await updateCalendarEventForAssistantRequest({
                    userId: targetUserId,
                    eventId: toolArgs.eventId,
                    calendarId: toolArgs.calendarId,
                    summary: toolArgs.summary,
                    description: toolArgs.description,
                    start: toolArgs.start,
                    end: toolArgs.end,
                    timeZone: toolArgs.timeZone,
                    location: toolArgs.location,
                    attendees: toolArgs.attendees,
                })

                console.log('📅 UPDATE_CALENDAR_EVENT TOOL: Update completed', {
                    success: result.success,
                    calendarId: result.calendarId || toolArgs.calendarId || null,
                    eventId: result.event?.eventId || toolArgs.eventId || null,
                })

                return result
            } catch (error) {
                console.error('📅 UPDATE_CALENDAR_EVENT TOOL: Update failed', {
                    error: error.message,
                    eventId: toolArgs.eventId,
                    requestUserId: targetUserId,
                })
                return {
                    success: false,
                    message: `Calendar event update failed: ${error.message}`,
                }
            }
        }

        case 'delete_calendar_event': {
            console.log('📅 DELETE_CALENDAR_EVENT TOOL: Starting Calendar delete', {
                eventId: toolArgs.eventId,
                calendarId: toolArgs.calendarId,
                requestUserId: requestUserId || null,
            })

            const targetUserId = requestUserId || creatorId
            if (!targetUserId) {
                return {
                    success: false,
                    message: 'Calendar event deletion requires a valid requesting user.',
                }
            }

            try {
                const { deleteCalendarEventForAssistantRequest } = require('../GoogleCalendar/assistantCalendarTools')
                const result = await deleteCalendarEventForAssistantRequest({
                    userId: targetUserId,
                    eventId: toolArgs.eventId,
                    calendarId: toolArgs.calendarId,
                })

                console.log('📅 DELETE_CALENDAR_EVENT TOOL: Delete completed', {
                    success: result.success,
                    calendarId: result.calendarId || toolArgs.calendarId || null,
                    eventId: result.eventId || toolArgs.eventId || null,
                })

                return result
            } catch (error) {
                console.error('📅 DELETE_CALENDAR_EVENT TOOL: Delete failed', {
                    error: error.message,
                    eventId: toolArgs.eventId,
                    requestUserId: targetUserId,
                })
                return {
                    success: false,
                    message: `Calendar event deletion failed: ${error.message}`,
                }
            }
        }

        default:
            throw new Error(`Unknown tool: ${toolName}`)
    }
}

async function storeChunks(
    projectId,
    objectType,
    objectId,
    userIdsToNotify,
    stream,
    parser,
    assistantId,
    isPublicFor,
    followerIds,
    objectName,
    assistantName,
    projectname,
    chatLink,
    requestUserId,
    userContext = null,
    conversationHistory = null,
    modelKey = null,
    temperatureKey = null,
    allowedTools = [],
    toolRuntimeContext = null
) {
    const chunksStartTime = Date.now()
    console.log('🔄 [TIMING] storeChunks START', {
        timestamp: new Date().toISOString(),
        projectId,
        objectType,
        objectId,
        hasStream: !!stream,
        assistantId,
    })

    try {
        // Step 1: Create initial comment
        const step1Start = Date.now()
        const initialStatusMessage = buildInitialAssistantRunStatusMessage()
        const { commentId, comment } = formatMessage(objectType, initialStatusMessage, assistantId)
        comment.isLoading = true
        comment.isThinking = false

        let promises = []
        promises.push(getCurrentFollowerIds(followerIds, projectId, objectType, objectId, isPublicFor))
        promises.push(
            admin
                .firestore()
                .doc(`chatComments/${projectId}/${objectType}/${objectId}/comments/${commentId}`)
                .set(comment)
        )

        const [currentFollowerIds] = await Promise.all(promises)
        const step1Duration = Date.now() - step1Start

        console.log(`📊 [TIMING] Initial setup: ${step1Duration}ms`, {
            commentId,
            followerCount: currentFollowerIds?.length,
        })

        const runtimeContextForTools = toolRuntimeContext || {
            projectId,
            assistantId,
            requestUserId,
        }

        let commentText = ''
        let thinkingMode = false
        let thinkingContent = ''
        let answerContent = ''
        let chunkCount = 0
        let toolAlreadyExecuted = false

        // Create a reference to the comment document for updates
        const commentRef = admin
            .firestore()
            .doc(`chatComments/${projectId}/${objectType}/${objectId}/comments/${commentId}`)

        // Batch update mechanism to reduce Firestore writes
        let pendingUpdate = null
        let updateTimeout = null
        const BATCH_UPDATE_DELAY_MS = 300 // Update every 300ms max (increased for better performance)
        const BATCH_UPDATE_CHUNK_THRESHOLD = 10 // Or every 10 chunks, whichever comes first (increased for better performance)

        const flushPendingUpdate = async () => {
            if (pendingUpdate) {
                const updateData = { ...pendingUpdate }
                pendingUpdate = null
                if (updateTimeout) {
                    clearTimeout(updateTimeout)
                    updateTimeout = null
                }
                await commentRef.update(updateData)
            }
        }

        const scheduleUpdate = async (updateData, immediate = false) => {
            // Merge with pending update
            pendingUpdate = { ...pendingUpdate, ...updateData }

            if (immediate) {
                // Flush immediately for critical updates (loading states, tool calls, etc.)
                await flushPendingUpdate()
                return
            }

            // Clear existing timeout
            if (updateTimeout) {
                clearTimeout(updateTimeout)
            }

            // Schedule update after delay or when threshold reached
            updateTimeout = setTimeout(async () => {
                await flushPendingUpdate()
            }, BATCH_UPDATE_DELAY_MS)
        }

        // Process each chunk from the stream
        const streamProcessStart = Date.now()
        let firstChunkTime = null
        let lastChunkTime = Date.now()
        let chunksSinceLastUpdate = 0
        console.log('🚀 [TIMING] Starting stream processing...')

        // Track time-to-first-token from function start (use global if available)
        const timeToFirstTokenStart = globalFunctionStartTime || streamProcessStart

        console.log('🚀 [TIMING] About to enter stream loop in storeChunks')
        for await (const chunk of stream) {
            chunkCount++
            const chunkTime = Date.now()

            if (!firstChunkTime) {
                firstChunkTime = chunkTime
                const timeToFirstToken = firstChunkTime - timeToFirstTokenStart
                const timeFromStreamStart = firstChunkTime - streamProcessStart
                const timeFromInitialSetup = firstChunkTime - chunksStartTime
                console.log(`⚡ [TIMING] FIRST TOKEN RECEIVED`, {
                    timeToFirstToken: `${timeToFirstToken}ms`,
                    timeFromStreamStart: `${timeFromStreamStart}ms`,
                    timeFromInitialSetup: `${timeFromInitialSetup}ms`,
                    timestamp: new Date().toISOString(),
                    functionStartTime: timeToFirstTokenStart,
                    firstChunkTime: firstChunkTime,
                    breakdown: {
                        fromEntryPoint: `${timeToFirstToken}ms`,
                        fromStreamStart: `${timeFromStreamStart}ms`,
                        fromInitialSetup: `${timeFromInitialSetup}ms`,
                    },
                })
            }

            if (ENABLE_DETAILED_LOGGING) {
                console.log(`📦 [TIMING] Chunk #${chunkCount}:`, {
                    timeSinceLastChunk: `${chunkTime - lastChunkTime}ms`,
                    timeSinceStart: `${chunkTime - streamProcessStart}ms`,
                    hasContent: !!chunk.content,
                    contentLength: chunk.content?.length,
                    isLoading: chunk.isLoading,
                    isThinking: chunk.isThinking,
                    clearThinkingMode: chunk.clearThinkingMode,
                    hasReplacementContent: !!chunk.replacementContent,
                })
            }

            lastChunkTime = chunkTime

            // If a tool was already executed, skip all remaining chunks from the stream
            if (toolAlreadyExecuted) {
                if (ENABLE_DETAILED_LOGGING) {
                    console.log('Tool already executed, discarding remaining stream chunk')
                }
                continue
            }

            // Handle native OpenAI tool calls (from GPT models with native tool calling)
            if (chunk.additional_kwargs?.tool_calls && Array.isArray(chunk.additional_kwargs.tool_calls)) {
                if (ENABLE_DETAILED_LOGGING) {
                    console.log('🔧 NATIVE TOOL CALL: Detected native tool call', {
                        toolCallsCount: chunk.additional_kwargs.tool_calls.length,
                        toolCalls: chunk.additional_kwargs.tool_calls.map(tc => ({
                            id: tc.id,
                            name: tc.function?.name,
                            argsLength: tc.function?.arguments?.length,
                        })),
                    })
                }

                // Check if we have conversation history to resume with
                if (!conversationHistory || !modelKey || !temperatureKey) {
                    console.warn(
                        '🔧 NATIVE TOOL CALL: Missing conversation history or model info - tools disabled for this model'
                    )
                    await flushPendingUpdate() // Flush any pending updates first
                    commentText += '\n\n[Tools are only available for GPT models]'
                    await commentRef.update({ commentText, isLoading: false })
                    toolAlreadyExecuted = true
                    continue
                }

                // Execute tool calls in a loop to support multi-step tool calling
                let currentConversation = conversationHistory
                let currentToolCalls = chunk.additional_kwargs.tool_calls
                let toolCallIteration = 0

                while (
                    currentToolCalls &&
                    currentToolCalls.length > 0 &&
                    toolCallIteration < MAX_NATIVE_TOOL_CALL_ITERATIONS
                ) {
                    toolCallIteration++
                    if (ENABLE_DETAILED_LOGGING) {
                        console.log('🔧 NATIVE TOOL CALL: Starting tool call iteration #' + toolCallIteration, {
                            toolCallsCount: currentToolCalls.length,
                            maxIterations: MAX_NATIVE_TOOL_CALL_ITERATIONS,
                        })
                    }

                    // Process first tool call (OpenAI typically sends one at a time)
                    const toolCall = currentToolCalls[0]
                    const toolName = toolCall.function.name
                    const toolCallId = toolCall.id

                    // Parse arguments
                    let toolArgs = {}
                    try {
                        toolArgs = JSON.parse(toolCall.function.arguments)
                        if (ENABLE_DETAILED_LOGGING) {
                            console.log('🔧 NATIVE TOOL CALL: Parsed arguments', { toolName, toolArgs })
                        }
                    } catch (e) {
                        console.error('🔧 NATIVE TOOL CALL: Failed to parse arguments', e)
                        commentText += `\n\nError: Failed to parse tool arguments for ${toolName}`
                        await commentRef.update({ commentText, isLoading: false })
                        toolAlreadyExecuted = true
                        break // Exit the while loop
                    }

                    // Check permissions
                    const assistant = await getAssistantForChat(projectId, assistantId, requestUserId, {
                        forceRefresh: true,
                    })
                    const allowed = await isToolAllowedForExecution(
                        Array.isArray(assistant.allowedTools) ? assistant.allowedTools : [],
                        toolName,
                        runtimeContextForTools
                    )

                    if (!allowed) {
                        if (ENABLE_DETAILED_LOGGING) {
                            console.log('🔧 NATIVE TOOL CALL: Tool not permitted', { toolName })
                        }
                        await flushPendingUpdate() // Flush any pending updates first
                        commentText += `\n\nTool not permitted: ${toolName}`
                        await commentRef.update({ commentText, isLoading: false })
                        toolAlreadyExecuted = true
                        break // Exit the while loop
                    }

                    // Show loading indicator
                    await flushPendingUpdate() // Flush any pending updates first
                    const toolExecutionStartedAt = Date.now()
                    let toolStatusMessage = buildToolProgressStatusMessage({
                        toolName,
                        toolArgs,
                        toolCallIteration,
                        elapsedMs: 0,
                    })
                    commentText += `\n\n${toolStatusMessage}`
                    await commentRef.update({ commentText, isLoading: true })

                    let stopToolProgressUpdates = false
                    const updateToolProgressStatus = async () => {
                        if (stopToolProgressUpdates) return

                        const nextStatusMessage = buildToolProgressStatusMessage({
                            toolName,
                            toolArgs,
                            toolCallIteration,
                            elapsedMs: Date.now() - toolExecutionStartedAt,
                        })
                        if (nextStatusMessage === toolStatusMessage || stopToolProgressUpdates) return

                        commentText = commentText.replace(toolStatusMessage, nextStatusMessage)
                        toolStatusMessage = nextStatusMessage
                        if (stopToolProgressUpdates) return

                        await commentRef.update({ commentText, isLoading: true })
                    }

                    const toolProgressInterval = setInterval(() => {
                        updateToolProgressStatus().catch(error => {
                            console.warn('🔧 NATIVE TOOL CALL: Failed updating tool progress status', {
                                toolName,
                                error: error.message,
                            })
                        })
                    }, TOOL_PROGRESS_UPDATE_INTERVAL_MS)

                    if (ENABLE_DETAILED_LOGGING) {
                        console.log('🔧 NATIVE TOOL CALL: Executing tool', { toolName, toolArgs })
                    }

                    // Execute tool and get result
                    let toolResult
                    try {
                        if (ENABLE_DETAILED_LOGGING) {
                            console.log('🔧 NATIVE TOOL CALL: Starting tool execution', { toolName, toolArgs })
                        }
                        toolResult = await executeToolNatively(
                            toolName,
                            toolArgs,
                            projectId,
                            assistantId,
                            runtimeContextForTools.requestUserId || requestUserId,
                            userContext,
                            runtimeContextForTools
                        )
                        const toolResultString = JSON.stringify(toolResult, null, 2)
                        if (ENABLE_DETAILED_LOGGING) {
                            console.log('🔧 NATIVE TOOL CALL: Tool executed successfully', {
                                toolName,
                                resultLength: toolResultString.length,
                                resultPreview: toolResultString.substring(0, 500),
                                fullResult:
                                    toolResultString.length < 1000 ? toolResultString : '[Too large to display fully]',
                            })
                        }
                    } catch (error) {
                        stopToolProgressUpdates = true
                        clearInterval(toolProgressInterval)
                        console.error('🔧 NATIVE TOOL CALL: Tool execution failed', {
                            toolName,
                            error: error.message,
                            stack: error.stack,
                        })
                        await flushPendingUpdate() // Flush any pending updates first
                        const errorMsg = `Error executing ${toolName}: ${error.message}`
                        commentText = commentText.replace(toolStatusMessage, errorMsg)
                        await commentRef.update({ commentText, isLoading: false })
                        toolAlreadyExecuted = true
                        break // Exit the while loop
                    }
                    stopToolProgressUpdates = true
                    clearInterval(toolProgressInterval)

                    // Build new conversation history with tool result
                    // Need to add: assistant's message with tool call, then tool result message

                    // Collect all assistant content before tool call
                    const assistantMessageContent = commentText.replace(toolStatusMessage, '').trim()
                    if (ENABLE_DETAILED_LOGGING) {
                        console.log('🔧 NATIVE TOOL CALL: Building conversation update', {
                            assistantMessageContentLength: assistantMessageContent.length,
                            assistantMessageContent: assistantMessageContent.substring(0, 200),
                        })
                    }

                    // Build updated conversation with plain objects
                    const updatedConversation = [
                        ...currentConversation,
                        {
                            role: 'assistant',
                            content: assistantMessageContent,
                            tool_calls: [
                                {
                                    id: toolCallId,
                                    type: 'function',
                                    function: {
                                        name: toolName,
                                        arguments: JSON.stringify(toolArgs),
                                    },
                                },
                            ],
                        },
                        {
                            role: 'tool',
                            content: JSON.stringify(toolResult),
                            tool_call_id: toolCallId,
                        },
                        {
                            role: 'user',
                            content:
                                'Based on the tool results above, provide your response to the user. If any tool result indicates failure, blocked status, or no execution, do not claim completion. Explain what is missing and what should be tried next. If needed, call additional tools.',
                        },
                    ]

                    if (ENABLE_DETAILED_LOGGING) {
                        console.log('🔧 NATIVE TOOL CALL: Built updated conversation', {
                            conversationLength: updatedConversation.length,
                            originalHistoryLength: currentConversation.length,
                            toolResultLength: JSON.stringify(toolResult).length,
                            toolResultPreview: JSON.stringify(toolResult).substring(0, 500),
                            iteration: toolCallIteration,
                            lastThreeMessages: updatedConversation.slice(-3).map(m => ({
                                role: m.role,
                                hasContent: !!m.content,
                                contentLength: m.content?.length,
                                contentPreview: m.content?.substring(0, 150),
                                hasToolCalls: !!m.tool_calls,
                                toolCallsCount: m.tool_calls?.length,
                                hasToolCallId: !!m.tool_call_id,
                            })),
                        })
                    }

                    // Update currentConversation for next iteration
                    currentConversation = updatedConversation

                    // Resume stream with updated conversation
                    if (ENABLE_DETAILED_LOGGING) {
                        console.log('🔧 NATIVE TOOL CALL: Calling interactWithChatStream with updated conversation', {
                            modelKey,
                            temperatureKey,
                            allowedToolsCount: allowedTools?.length,
                            allowedTools,
                            iteration: toolCallIteration,
                        })
                    }
                    const newStream = await interactWithChatStream(
                        updatedConversation,
                        modelKey,
                        temperatureKey,
                        allowedTools,
                        runtimeContextForTools
                    )
                    if (ENABLE_DETAILED_LOGGING) {
                        console.log('🔧 NATIVE TOOL CALL: Got new stream from interactWithChatStream')
                    }

                    // Remove loading indicator
                    await flushPendingUpdate() // Flush any pending updates first
                    commentText = commentText.replace(toolStatusMessage, '')
                    await commentRef.update({ commentText, isLoading: false })

                    // Process the new stream - replace the current stream
                    if (ENABLE_DETAILED_LOGGING) {
                        console.log('🔧 NATIVE TOOL CALL: Starting to process resumed stream chunks')
                    }

                    // Process all chunks from the new stream
                    let resumedChunkCount = 0
                    let totalContentReceived = 0
                    let nextToolCalls = null
                    let resumedChunksSinceLastUpdate = 0

                    for await (const newChunk of newStream) {
                        resumedChunkCount++

                        const logData = {
                            iteration: toolCallIteration,
                            chunkNumber: resumedChunkCount,
                            hasContent: !!newChunk.content,
                            contentLength: newChunk.content?.length || 0,
                            content: newChunk.content || '',
                            hasAdditionalKwargs: !!newChunk.additional_kwargs,
                            additionalKwargs: newChunk.additional_kwargs,
                        }

                        // Check if this chunk contains new tool calls (multi-step reasoning)
                        if (newChunk.additional_kwargs?.tool_calls) {
                            if (ENABLE_DETAILED_LOGGING) {
                                console.log('🔧 NATIVE TOOL CALL: RESUMED STREAM CONTAINS ADDITIONAL TOOL CALLS!', {
                                    ...logData,
                                    toolCallsCount: newChunk.additional_kwargs.tool_calls.length,
                                    toolCalls: newChunk.additional_kwargs.tool_calls.map(tc => ({
                                        id: tc.id,
                                        name: tc.function?.name,
                                        args: tc.function?.arguments,
                                    })),
                                })
                            }
                            // Store the tool calls to execute in next iteration
                            nextToolCalls = newChunk.additional_kwargs.tool_calls
                            // Don't break yet - let the stream finish
                        } else {
                            if (ENABLE_DETAILED_LOGGING) {
                                console.log('🔧 NATIVE TOOL CALL: Resumed stream chunk #' + resumedChunkCount, logData)
                            }
                        }

                        if (newChunk.content) {
                            totalContentReceived += newChunk.content.length
                            commentText += newChunk.content

                            // Use same chunk-threshold flushing as the main stream loop
                            resumedChunksSinceLastUpdate++
                            const shouldFlushImmediately = resumedChunksSinceLastUpdate >= BATCH_UPDATE_CHUNK_THRESHOLD

                            if (shouldFlushImmediately) {
                                resumedChunksSinceLastUpdate = 0
                                await flushPendingUpdate()
                            }

                            await scheduleUpdate({ commentText }, shouldFlushImmediately)

                            if (ENABLE_DETAILED_LOGGING) {
                                console.log('🔧 NATIVE TOOL CALL: Scheduled comment update with new content', {
                                    iteration: toolCallIteration,
                                    chunkNumber: resumedChunkCount,
                                    addedContentLength: newChunk.content.length,
                                    totalContentReceived,
                                    currentCommentLength: commentText.length,
                                    resumedChunksSinceLastUpdate,
                                    willFlushImmediately: shouldFlushImmediately,
                                })
                            }
                        }
                    }

                    // Flush any pending updates from resumed stream
                    await flushPendingUpdate()

                    if (ENABLE_DETAILED_LOGGING) {
                        console.log('🔧 NATIVE TOOL CALL: Finished processing resumed stream', {
                            iteration: toolCallIteration,
                            totalResumedChunks: resumedChunkCount,
                            totalContentReceived,
                            finalCommentLength: commentText.length,
                            finalCommentPreview: commentText.substring(0, 500),
                            hasNextToolCalls: !!nextToolCalls,
                            nextToolCallsCount: nextToolCalls?.length || 0,
                        })
                    }

                    // Check if we need to execute more tool calls
                    if (nextToolCalls && nextToolCalls.length > 0) {
                        if (ENABLE_DETAILED_LOGGING) {
                            console.log('🔧 NATIVE TOOL CALL: Continuing to next iteration with new tool calls', {
                                nextIteration: toolCallIteration + 1,
                                toolCallsCount: nextToolCalls.length,
                            })
                        }
                        currentToolCalls = nextToolCalls
                        // Continue the while loop
                    } else {
                        // No more tool calls, we're done
                        if (ENABLE_DETAILED_LOGGING) {
                            console.log('🔧 NATIVE TOOL CALL: No more tool calls, exiting loop', {
                                totalIterations: toolCallIteration,
                            })
                        }
                        currentToolCalls = null
                        // Exit the while loop
                    }
                } // End of while loop

                // Check if we hit max iterations
                if (toolCallIteration >= MAX_NATIVE_TOOL_CALL_ITERATIONS) {
                    await flushPendingUpdate() // Flush any pending updates first
                    console.warn('🔧 NATIVE TOOL CALL: Hit max tool call iterations!', {
                        maxIterations: MAX_NATIVE_TOOL_CALL_ITERATIONS,
                    })
                    commentText += '\n\n⚠️ Maximum tool call iterations reached'
                    await commentRef.update({ commentText, isLoading: false })
                }

                toolAlreadyExecuted = true // Mark as done
                break // Exit the main loop since we've processed everything
            }

            // Handle loading indicator for deep research (immediate update for critical states)
            if (chunk.isLoading) {
                await flushPendingUpdate() // Flush any pending updates first
                commentText = chunk.content
                await commentRef.update({
                    commentText: chunk.content,
                    isLoading: true,
                    isThinking: false,
                })
                if (ENABLE_DETAILED_LOGGING) {
                    console.log('Updated comment with loading state')
                }
                continue
            }

            // If we receive a signal to clear thinking and replace with answer content (immediate update)
            if (chunk.clearThinkingMode && chunk.replacementContent) {
                await flushPendingUpdate() // Flush any pending updates first
                thinkingMode = false
                // Replace the entire comment text with the answer content
                commentText = chunk.replacementContent
                answerContent = chunk.replacementContent

                await commentRef.update({
                    commentText,
                    isThinking: false,
                    isLoading: false,
                })
                if (ENABLE_DETAILED_LOGGING) {
                    console.log('Cleared thinking mode and updated with replacement content:', {
                        contentLength: commentText.length,
                    })
                }
                continue
            }

            // Track if this chunk is part of thinking mode
            if (chunk.isThinking !== undefined) {
                thinkingMode = chunk.isThinking
            }

            // Add the content to our accumulated text
            const contentToAdd = parser ? parser(chunk.content) : chunk.content
            if (ENABLE_DETAILED_LOGGING) {
                console.log('Content to add:', {
                    originalLength: chunk.content?.length,
                    parsedLength: contentToAdd?.length,
                    isThinkingMode: thinkingMode,
                })
            }

            // If in thinking mode, accumulate thinking content separately
            if (thinkingMode) {
                thinkingContent += contentToAdd
                commentText = thinkingContent
            } else {
                // If not in thinking mode, accumulate answer content
                answerContent += contentToAdd
                commentText = answerContent
            }

            // Batch update: schedule update instead of immediate write
            chunksSinceLastUpdate++
            const shouldFlushImmediately = chunksSinceLastUpdate >= BATCH_UPDATE_CHUNK_THRESHOLD

            if (shouldFlushImmediately) {
                chunksSinceLastUpdate = 0
                await flushPendingUpdate()
            }

            scheduleUpdate(
                {
                    commentText,
                    isThinking: thinkingMode,
                    isLoading: false,
                },
                shouldFlushImmediately
            )

            if (ENABLE_DETAILED_LOGGING) {
                console.log('Scheduled comment update:', {
                    commentLength: commentText.length,
                    isThinking: thinkingMode,
                    chunksSinceLastUpdate,
                    willFlushImmediately: shouldFlushImmediately,
                })
            }

            // Note: Manual TOOL: format parsing removed - native tool calling only
            // Tools are only available for GPT models that support native tool calling
        }

        // Flush any pending updates before final operations
        await flushPendingUpdate()

        if (ENABLE_DETAILED_LOGGING) {
            console.log('Finished processing stream chunks:', {
                totalChunks: chunkCount,
                finalCommentLength: commentText.length,
            })
        }

        // Simple validation: warn if assistant mentioned actions without tool calls
        validateToolCallConsistency(commentText)

        const lastComment = cleanTextMetaData(removeFormatTagsFromText(commentText), true)
        if (ENABLE_DETAILED_LOGGING) {
            console.log('Generated last comment:', {
                hasLastComment: !!lastComment,
                lastCommentLength: lastComment?.length,
                originalLength: commentText.length,
            })
        }

        promises = []

        if (ENABLE_DETAILED_LOGGING) {
            console.log('Updating last assistant comment data...')
        }
        promises.push(updateLastAssistantCommentData(projectId, objectType, objectId, currentFollowerIds, assistantId))

        if (ENABLE_DETAILED_LOGGING) {
            console.log('Generating notifications...')
        }
        promises.push(
            generateNotifications(
                projectId,
                objectType,
                objectId,
                userIdsToNotify,
                objectName,
                assistantName,
                projectname,
                chatLink,
                commentId,
                lastComment,
                currentFollowerIds,
                assistantId,
                requestUserId
            )
        )

        if (ENABLE_DETAILED_LOGGING) {
            console.log('Updating chat object...')
            console.log('KW SPECIAL Chat update data:', {
                objectId,
                projectId,
                assistantId,
                userIdsToNotify,
                members: [userIdsToNotify[0], assistantId],
                path: `chatObjects/${projectId}/chats/${objectId}`,
            })
        }
        promises.push(
            admin
                .firestore()
                .doc(`chatObjects/${projectId}/chats/${objectId}`)
                .update({
                    members: [userIdsToNotify[0], assistantId], // Ensure user is first, then assistant
                    lastEditionDate: Date.now(),
                    [`commentsData.lastCommentOwnerId`]: assistantId,
                    [`commentsData.lastComment`]: lastComment,
                    [`commentsData.lastCommentType`]: STAYWARD_COMMENT,
                    [`commentsData.amount`]: admin.firestore.FieldValue.increment(1), // Fixed: increment counter instead of resetting to 1
                })
        )

        if (ENABLE_DETAILED_LOGGING) {
            console.log('Updating last comment data...')
        }
        promises.push(
            updateLastCommentDataOfChatParentObject(projectId, objectId, objectType, commentText, STAYWARD_COMMENT)
        )

        // Final operations
        const finalOpsStart = Date.now()
        console.log('🔨 [TIMING] Starting final operations...')
        await Promise.all(promises)
        const finalOpsDuration = Date.now() - finalOpsStart

        const streamProcessDuration = Date.now() - streamProcessStart
        const totalDuration = Date.now() - chunksStartTime

        console.log('🔄 [TIMING] storeChunks COMPLETE', {
            totalDuration: `${totalDuration}ms`,
            breakdown: {
                initialSetup: `${step1Duration}ms`,
                streamProcessing: `${streamProcessDuration}ms`,
                timeToFirstChunk: firstChunkTime ? `${firstChunkTime - streamProcessStart}ms` : 'N/A',
                finalOperations: `${finalOpsDuration}ms`,
            },
            stats: {
                totalChunks: chunkCount,
                commentLength: commentText.length,
            },
        })

        return commentText
    } catch (error) {
        console.error('❌ [TIMING] Error in storeChunks:', {
            error: error.message,
            duration: `${Date.now() - chunksStartTime}ms`,
            chunksProcessed: chunkCount,
        })
        throw error
    }
}

const getLinkedParentChatUrl = (projectId, objectType, objectId) => {
    const origin = inProductionEnvironment() ? 'https://my.alldone.app' : 'https://mystaging.alldone.app'
    return `${origin}/projects/${projectId}/${objectType === 'topics' ? 'chats' : objectType}/${objectId}/chat`
}

async function getCommonData(projectId, objectType, objectId) {
    const promises = []
    promises.push(getProject(projectId, admin))
    promises.push(getChat(projectId, objectId))
    const [project, chat] = await Promise.all(promises)

    const chatLink = getLinkedParentChatUrl(projectId, objectType, objectId)

    return { project, chat, chatLink }
}

// Global variable to track function start time for time-to-first-token calculation
let globalFunctionStartTime = null

async function storeBotAnswerStream(
    projectId,
    objectType,
    objectId,
    stream,
    userIdsToNotify,
    isPublicFor,
    parser,
    assistantId,
    followerIds,
    assistantName,
    requestUserId,
    userContext = null,
    conversationHistory = null,
    modelKey = null,
    temperatureKey = null,
    allowedTools = [],
    commonData = null, // Optional pre-fetched common data to reduce time-to-first-token
    functionStartTime = null, // Optional function start time for time-to-first-token tracking
    toolRuntimeContext = null
) {
    const streamProcessStart = Date.now()
    // Store function start time globally for time-to-first-token tracking
    if (functionStartTime) {
        globalFunctionStartTime = functionStartTime
    }

    console.log('💾 [TIMING] storeBotAnswerStream START', {
        timestamp: new Date().toISOString(),
        projectId,
        objectType,
        objectId,
        assistantId,
        hasStream: !!stream,
        hasPreFetchedCommonData: !!commonData,
        functionStartTime: functionStartTime || globalFunctionStartTime,
    })

    try {
        // Fetch common data (or use pre-fetched data)
        const commonDataStart = Date.now()
        const { project, chat, chatLink } = commonData || (await getCommonData(projectId, objectType, objectId))
        const commonDataDuration = Date.now() - commonDataStart

        console.log(`📊 [TIMING] Common data fetch: ${commonDataDuration}ms`, {
            hasProject: !!project,
            hasChat: !!chat,
            hasChatLink: !!chatLink,
            wasPreFetched: !!commonData,
        })

        // Store chunks
        const storeChunksStart = Date.now()
        const result = chat
            ? await storeChunks(
                  projectId,
                  objectType,
                  objectId,
                  userIdsToNotify,
                  stream,
                  parser,
                  assistantId,
                  isPublicFor,
                  followerIds,
                  chat.title,
                  assistantName,
                  project.name,
                  chatLink,
                  requestUserId || '',
                  userContext,
                  conversationHistory,
                  modelKey,
                  temperatureKey,
                  allowedTools,
                  toolRuntimeContext
              )
            : ''
        const storeChunksDuration = Date.now() - storeChunksStart

        const totalDuration = Date.now() - streamProcessStart
        console.log('💾 [TIMING] storeBotAnswerStream COMPLETE', {
            totalDuration: `${totalDuration}ms`,
            breakdown: {
                commonDataFetch: `${commonDataDuration}ms`,
                storeChunks: `${storeChunksDuration}ms`,
            },
            hasText: !!result,
            textLength: result?.length,
        })

        return result
    } catch (error) {
        console.error('❌ [TIMING] Error in storeBotAnswerStream:', {
            error: error.message,
            duration: `${Date.now() - streamProcessStart}ms`,
        })
        throw error
    }
}

function replaceUserNameByMention(userName, userId, text) {
    const paresdName = `@${userName.replace(/ /g, MENTION_SPACE_CODE)}#${userId} `
    const re = new RegExp(`${userName}`, 'gi')
    return text.replace(re, paresdName)
}

function addSpaceToUrl(url, text) {
    const re = new RegExp(`${url}`, 'gi')
    return text.replace(re, ` ${url} `)
}

// Cache for assistant data (5 minute TTL)
const assistantCache = new Map()
const ASSISTANT_CACHE_TTL = 5 * 60 * 1000 // 5 minutes
const ASSISTANT_ONLY_CACHE_PREFIX = '__assistant__'

const getAssistantProjectCacheKey = (projectId, assistantId) => `${projectId}_${assistantId}`
const getAssistantOnlyCacheKey = assistantId => `${ASSISTANT_ONLY_CACHE_PREFIX}_${assistantId}`

const primeDefaultAssistantCache = async () => {
    if (typeof getDefaultAssistantData !== 'function') {
        return
    }
    try {
        const defaultAssistant = await getDefaultAssistantData(admin)
        if (defaultAssistant?.uid) {
            const normalizedAssistant = {
                ...defaultAssistant,
                model: normalizeModelKey(defaultAssistant.model || 'MODEL_GPT5_4'),
                temperature: defaultAssistant.temperature || 'TEMPERATURE_NORMAL',
                instructions: defaultAssistant.instructions || 'You are a helpful assistant.',
                allowedTools: Array.isArray(defaultAssistant.allowedTools) ? defaultAssistant.allowedTools : [],
            }
            assistantCache.set(getAssistantOnlyCacheKey(defaultAssistant.uid), {
                data: normalizedAssistant,
                timestamp: Date.now(),
            })
        }
    } catch (error) {
        console.log('⚙️ ASSISTANT SETTINGS: Unable to warm assistant cache', {
            error: error.message,
        })
    }
}

primeDefaultAssistantCache()

async function getAssistantForChat(projectId, assistantId, userId = null, options = {}) {
    const fetchStart = Date.now()
    const now = Date.now()
    const cacheKey = getAssistantProjectCacheKey(projectId, assistantId)
    const forceRefresh = options?.forceRefresh === true

    let cached = null
    if (!forceRefresh) {
        // Check cache first
        cached = assistantCache.get(cacheKey)
        if (cached && now - cached.timestamp < ASSISTANT_CACHE_TTL) {
            console.log('⚙️ ASSISTANT SETTINGS: Using cached assistant data', {
                cacheHit: true,
                duration: `${Date.now() - fetchStart}ms`,
                cacheSource: 'project',
            })
            return cached.data
        }

        // Fallback to assistant-only cache entry
        if (!cached) {
            const assistantOnlyKey = getAssistantOnlyCacheKey(assistantId)
            const assistantOnlyCached = assistantCache.get(assistantOnlyKey)
            if (assistantOnlyCached && now - assistantOnlyCached.timestamp < ASSISTANT_CACHE_TTL) {
                assistantCache.set(cacheKey, assistantOnlyCached)
                console.log('⚙️ ASSISTANT SETTINGS: Using cached assistant data', {
                    cacheHit: true,
                    duration: `${Date.now() - fetchStart}ms`,
                    cacheSource: 'assistant_only',
                })
                return assistantOnlyCached.data
            }
        }
    } else {
        console.log('⚙️ ASSISTANT SETTINGS: Bypassing cache (force refresh)', {
            projectId,
            assistantId,
        })
    }

    let assistant = null
    if (assistantId) {
        const db = admin.firestore()
        const parallelStart = Date.now()
        const [globalDoc, projectDoc] = await db.getAll(
            db.doc(`assistants/${GLOBAL_PROJECT_ID}/items/${assistantId}`),
            db.doc(`assistants/${projectId}/items/${assistantId}`)
        )
        const parallelDuration = Date.now() - parallelStart
        const globalAssistant = globalDoc?.exists ? { ...globalDoc.data(), uid: globalDoc.id } : null
        const projectAssistant = projectDoc?.exists ? { ...projectDoc.data(), uid: projectDoc.id } : null
        // Project-level assistant settings must override global defaults when both exist.
        assistant = projectAssistant || globalAssistant
        console.log('⚙️ ASSISTANT SETTINGS: Fetched assistant data (batched)', {
            cacheHit: false,
            parallelDuration: `${parallelDuration}ms`,
            foundInGlobal: !!globalAssistant,
            foundInProject: !!projectAssistant,
            selectedSource: projectAssistant ? 'project' : globalAssistant ? 'global' : 'none',
        })

        // If not found, check user's default project (for cross-project assistant use)
        if (!assistant && userId) {
            const userDoc = await db.doc(`users/${userId}`).get()
            const defaultProjectId = userDoc.exists ? userDoc.data().defaultProjectId : null
            if (defaultProjectId && defaultProjectId !== projectId) {
                const defaultProjectDoc = await db.doc(`assistants/${defaultProjectId}/items/${assistantId}`).get()
                if (defaultProjectDoc.exists) {
                    assistant = { ...defaultProjectDoc.data(), uid: defaultProjectDoc.id }
                    console.log('⚙️ ASSISTANT SETTINGS: Found assistant in user default project', {
                        defaultProjectId,
                        assistantId,
                    })
                }
            }
        }
    }
    if (!assistant) {
        const defaultStart = Date.now()
        assistant = await getDefaultAssistantData(admin)
        console.log('⚙️ ASSISTANT SETTINGS: Fetched default assistant', {
            duration: `${Date.now() - defaultStart}ms`,
        })
    }
    // Provide fallback defaults for missing fields
    assistant = assistant || {}
    assistant.model = normalizeModelKey(assistant?.model || 'MODEL_GPT5_4')
    assistant.temperature = assistant?.temperature || 'TEMPERATURE_NORMAL'
    assistant.instructions = assistant?.instructions || 'You are a helpful assistant.'
    assistant.allowedTools = Array.isArray(assistant?.allowedTools) ? assistant.allowedTools : []
    assistant.uid = assistant?.uid || assistantId

    // Cache the result
    if (assistant) {
        const cachePayload = { data: assistant, timestamp: now }
        assistantCache.set(cacheKey, cachePayload)
        if (assistant.uid) {
            assistantCache.set(getAssistantOnlyCacheKey(assistant.uid), cachePayload)
        }
        // Clean old cache entries if cache gets too large
        if (assistantCache.size > 100) {
            const oldestKey = assistantCache.keys().next().value
            assistantCache.delete(oldestKey)
        }
    }

    const totalDuration = Date.now() - fetchStart
    console.log('⚙️ ASSISTANT SETTINGS: getAssistantForChat completed', {
        totalDuration: `${totalDuration}ms`,
        cached: !!cached,
    })

    return assistant
}

// New function to get task-level settings or fall back to assistant settings
async function getTaskOrAssistantSettings(projectId, taskId, assistantId) {
    const settingsStart = Date.now()
    console.log('⚙️ ASSISTANT SETTINGS: Getting task or assistant settings:', { projectId, taskId, assistantId })

    // Fetch task data and assistant settings in parallel
    const parallelStart = Date.now()
    const [taskDoc, assistant] = await Promise.all([
        admin.firestore().doc(`assistantTasks/${projectId}/${assistantId}/${taskId}`).get(),
        getAssistantForChat(projectId, assistantId, null, { forceRefresh: true }),
    ])
    const parallelDuration = Date.now() - parallelStart
    console.log('⚙️ ASSISTANT SETTINGS: Parallel fetch completed', {
        parallelDuration: `${parallelDuration}ms`,
    })

    const task = taskDoc.data()
    console.log('⚙️ ASSISTANT SETTINGS: Task data:', {
        hasTask: !!task,
        taskAiModel: task?.aiModel,
        taskAiTemperature: task?.aiTemperature,
        hasTaskAiSystemMessage: !!task?.aiSystemMessage,
    })
    console.log('⚙️ ASSISTANT SETTINGS: Assistant data:', {
        hasAssistant: !!assistant,
        assistantModel: assistant?.model,
        assistantTemperature: assistant?.temperature,
        hasAssistantInstructions: !!assistant?.instructions,
        assistantDisplayName: assistant?.displayName,
        allowedToolsCount: assistant?.allowedTools?.length || 0,
    })

    // Return task settings if they exist, otherwise use assistant settings with defaults
    const settings = {
        model: normalizeModelKey((task && task.aiModel) || assistant.model || 'MODEL_GPT5_4'),
        temperature: (task && task.aiTemperature) || assistant.temperature || 'TEMPERATURE_NORMAL',
        instructions: (task && task.aiSystemMessage) || assistant.instructions || 'You are a helpful assistant.',
        displayName: assistant.displayName, // Always use assistant's display name
        uid: assistant.uid, // Always use assistant's uid
        allowedTools: Array.isArray(assistant.allowedTools) ? assistant.allowedTools : [],
    }

    console.log('⚙️ ASSISTANT SETTINGS: Final resolved settings:', {
        finalModel: settings.model,
        finalTemperature: settings.temperature,
        hasInstructions: !!settings.instructions,
        displayName: settings.displayName,
        allowedTools: settings.allowedTools,
        modelTokensPerGold: getTokensPerGold(settings.model),
        settingsSource: {
            model: task && task.aiModel ? 'task' : 'assistant',
            temperature: task && task.aiTemperature ? 'task' : 'assistant',
            instructions: task && task.aiSystemMessage ? 'task' : 'assistant',
        },
        totalDuration: `${Date.now() - settingsStart}ms`,
    })
    return settings
}

async function addBaseInstructions(
    messages,
    name,
    language,
    instructions,
    allowedTools = [],
    userTimezoneOffset = null,
    assistantContext = null
) {
    // messages.push(['system', `Your responses must be limited to ${COMPLETION_MAX_TOKENS} tokens.`])
    messages.push(['system', `You are an AI assistant  and your name is: "${parseTextForUseLiKePrompt(name || '')}"`])
    // Prevent AI from summarizing/referencing previous conversation before answering
    messages.push([
        'system',
        "Respond directly to the user's latest message without preamble and do not repeat the timestamp and names of the previous messages which are only given for your context.",
    ])
    // messages.push(['system', `Speak in ${parseTextForUseLiKePrompt(language || 'English')}`])
    messages.push(['system', `Speak in the same language the user speaks`])

    // Generate current date/time in user's timezone if available
    let currentDateTime
    let timezoneInfo
    if (userTimezoneOffset !== null && typeof userTimezoneOffset === 'number') {
        // userTimezoneOffset is in minutes
        currentDateTime = moment().utcOffset(userTimezoneOffset)
        // Format timezone as UTC+X or UTC-X
        const hours = Math.floor(Math.abs(userTimezoneOffset) / 60)
        const minutes = Math.abs(userTimezoneOffset) % 60
        const sign = userTimezoneOffset >= 0 ? '+' : '-'
        timezoneInfo = minutes > 0 ? `UTC${sign}${hours}:${minutes.toString().padStart(2, '0')}` : `UTC${sign}${hours}`
    } else {
        // Fallback to UTC if no timezone provided
        currentDateTime = moment().utc()
        timezoneInfo = 'UTC'
    }
    messages.push([
        'system',
        `The current date and time for the user is ${currentDateTime.format(
            'dddd, MMMM Do YYYY, h:mm:ss a'
        )} (${timezoneInfo}).`,
    ])

    if (assistantContext?.projectId && assistantContext?.requestUserId) {
        try {
            const userMemoryContext = await getUserMemoryContextMessage({
                projectId: assistantContext.projectId,
                requestUserId: assistantContext.requestUserId,
            })
            if (userMemoryContext) messages.push(['system', parseTextForUseLiKePrompt(userMemoryContext)])
        } catch (error) {
            console.warn('ASSISTANT CONTEXT: Failed to load user memory context', {
                projectId: assistantContext.projectId,
                requestUserId: assistantContext.requestUserId,
                error: error.message,
            })
        }
    }

    // Add emphasis on immediate action for tool-enabled assistants
    if (Array.isArray(allowedTools) && allowedTools.length > 0) {
        messages.push([
            'system',
            `IMPORTANT: You are action-oriented. When users ask you to do something, DO IT IMMEDIATELY - don't just talk about doing it. ` +
                `However, do NOT call any tools for casual conversation like greetings ("hello", "hi", "hey", "how are you"), thank-yous, or small talk. ` +
                `Only use tools when the user clearly intends an action (e.g. "create a task called X", "add X to my tasks", "search for Y", "remind me to Z"). ` +
                `When in doubt whether the user wants an action or is just chatting, respond with text only.`,
        ])
    }
    if (Array.isArray(allowedTools) && allowedTools.includes('search_gmail')) {
        messages.push([
            'system',
            'When the user asks about email history, what they discussed with someone in email, or to find emails by person or topic, use the search_gmail tool instead of guessing.',
        ])
    }
    if (
        Array.isArray(allowedTools) &&
        allowedTools.some(toolName => ['create_gmail_reply_draft', 'create_gmail_draft'].includes(toolName))
    ) {
        messages.push([
            'system',
            'When the user asks you to draft, compose, or prepare an email, use the Gmail draft tools instead of only describing the email. Use create_gmail_reply_draft for replies to existing email threads and create_gmail_draft for brand-new emails. Draft emails only; do not claim you sent anything.',
        ])
    }
    if (
        Array.isArray(allowedTools) &&
        allowedTools.some(toolName =>
            [
                'search_calendar_events',
                'create_calendar_event',
                'update_calendar_event',
                'delete_calendar_event',
            ].includes(toolName)
        )
    ) {
        messages.push([
            'system',
            'When the user asks about their schedule, calendar history, meetings, or to create, move, update, or delete calendar entries, use the Calendar tools instead of guessing. For update/delete, use exact event targets and ask the tool for disambiguation rather than assuming the right calendar account.',
        ])
    }
    const preConfiguredTasksContext = await getPreConfiguredTasksContextMessage(
        assistantContext?.projectId,
        assistantContext?.assistantId
    )
    if (preConfiguredTasksContext.message) {
        messages.push(['system', parseTextForUseLiKePrompt(preConfiguredTasksContext.message)])
        console.log('🤖 PRECONFIG CONTEXT: Added pre-configured task instructions', {
            projectId: assistantContext?.projectId || null,
            assistantId: assistantContext?.assistantId || null,
            includedTasks: preConfiguredTasksContext.includedCount,
            totalRelevantTasks: preConfiguredTasksContext.totalCount,
        })
    }
    messages.push([
        'system',
        'Always left a space between links and words. Do not wrap links inside [],{{}},() or any other characters',
    ])
    // Note: Tool instructions removed - using OpenAI native tool calling instead of manual TOOL: format
    if (instructions) messages.push(['system', parseTextForUseLiKePrompt(instructions)])
}

function parseTextForUseLiKePrompt(text) {
    if (!text) return ''
    return text.replaceAll('{', '{{').replaceAll('}', '}}')
}

function extractImageUrlsFromCommentText(commentText) {
    if (!commentText || typeof commentText !== 'string') return []

    const words = commentText.split(/\s+/)
    const urls = []

    for (const word of words) {
        if (!word || !word.includes(IMAGE_TRIGGER) || !REGEX_IMAGE_TOKEN.test(word)) continue
        const { uri, resizedUri } = getImageData(word)
        const imageUrl = uri || resizedUri
        if (imageUrl) urls.push(imageUrl)
    }

    return [...new Set(urls)]
}

function buildMultimodalUserContent(text, imageUrls = []) {
    if (!Array.isArray(imageUrls) || imageUrls.length === 0) return text || ''

    const content = []
    const normalizedText = (text || '').trim() || `User attached ${imageUrls.length} image(s).`
    content.push({ type: 'text', text: normalizedText })

    imageUrls.forEach(url => {
        if (!url) return
        content.push({
            type: 'image_url',
            image_url: { url },
        })
    })

    return content
}

function getMessageTextForTokenCounting(content) {
    if (!content) return ''
    if (typeof content === 'string') return content
    if (Array.isArray(content)) {
        return content
            .map(part => {
                if (!part || typeof part !== 'object') return ''
                if (part.type === 'text') return part.text || ''
                if (part.type === 'image_url') return '[Image]'
                return ''
            })
            .join(' ')
            .trim()
    }
    if (typeof content === 'object') return content.content || ''
    return String(content)
}

/**
 * Get all active projects for a user with open task counts (today + overdue)
 * Projects are sorted in the same order as shown in the sidebar (by sortIndexByUser desc, then name asc)
 * @param {string} userId - The user ID
 * @param {number|null} userTimezoneOffset - User's timezone offset in minutes
 * @returns {Promise<{projects: Array<{id: string, name: string, openTaskCount: number}>, totalCount: number}|null>}
 */
async function getOpenTasksForAllProjects(userId, userTimezoneOffset = null) {
    try {
        // Calculate end of today in user's timezone
        // userTimezoneOffset can be in hours (e.g., 1 for UTC+1) or minutes (e.g., 60 for UTC+1)
        // We need to match the n8n approach: UTC end of day minus timezone offset in ms
        let dateEndToday
        if (userTimezoneOffset !== null && typeof userTimezoneOffset === 'number') {
            // Determine if offset is in hours or minutes (if abs value < 24, assume hours)
            const offsetInHours = Math.abs(userTimezoneOffset) < 24 ? userTimezoneOffset : userTimezoneOffset / 60
            // End of day in UTC, then adjust for user's timezone
            // For UTC+1: end of day is 23:59:59 local = 22:59:59 UTC, so subtract 1 hour from UTC end of day
            dateEndToday = new Date().setUTCHours(23, 59, 59, 999) - offsetInHours * 60 * 60 * 1000
        } else {
            dateEndToday = moment().endOf('day').valueOf()
        }

        // Get user data to find their active projects
        const userDoc = await admin.firestore().collection('users').doc(userId).get()
        if (!userDoc.exists) {
            console.error('User not found for open tasks count:', userId)
            return null
        }

        const userData = userDoc.data()
        const projectIds = Array.isArray(userData.projectIds) ? userData.projectIds : []
        const archivedProjectIds = Array.isArray(userData.archivedProjectIds) ? userData.archivedProjectIds : []
        const templateProjectIds = Array.isArray(userData.templateProjectIds) ? userData.templateProjectIds : []
        const guideProjectIds = Array.isArray(userData.guideProjectIds) ? userData.guideProjectIds : []

        // Filter to only active projects (same logic as sidebar)
        const activeProjectIds = projectIds.filter(
            id => !archivedProjectIds.includes(id) && !templateProjectIds.includes(id) && !guideProjectIds.includes(id)
        )

        if (activeProjectIds.length === 0) {
            return { projects: [], totalCount: 0 }
        }

        // Fetch project data and task counts in parallel
        // Count both reviewer tasks AND observed tasks (same as sidebar)
        const allowUserIds = [FEED_PUBLIC_FOR_ALL, userId]

        const projectPromises = activeProjectIds.map(async projectId => {
            const [projectDoc, reviewerTasksSnapshot, observedTasksSnapshot] = await Promise.all([
                admin.firestore().collection('projects').doc(projectId).get(),
                // Query 1: Tasks where user is the current reviewer
                admin
                    .firestore()
                    .collection(`items/${projectId}/tasks`)
                    .where('inDone', '==', false)
                    .where('parentId', '==', null)
                    .where('currentReviewerId', '==', userId)
                    .where('dueDate', '<=', dateEndToday)
                    .where('isPublicFor', 'array-contains-any', allowUserIds)
                    .get(),
                // Query 2: Tasks where user is an observer
                // Note: Cannot combine with isPublicFor filter (Firestore only allows one array operation per query)
                admin
                    .firestore()
                    .collection(`items/${projectId}/tasks`)
                    .where('inDone', '==', false)
                    .where('parentId', '==', null)
                    .where('observersIds', 'array-contains', userId)
                    .get(),
            ])

            if (!projectDoc.exists) {
                return null
            }

            // Count reviewer tasks
            const reviewerCount = reviewerTasksSnapshot.docs.length

            // Count observed tasks where the observer's due date is today or earlier
            // and the task is visible to the user (isPublicFor check)
            let observedCount = 0
            const reviewerTaskIds = new Set(reviewerTasksSnapshot.docs.map(doc => doc.id))

            observedTasksSnapshot.docs.forEach(doc => {
                // Skip if already counted as reviewer task
                if (reviewerTaskIds.has(doc.id)) {
                    return
                }

                const data = doc.data()

                // Check isPublicFor (since we couldn't filter it in the query)
                const isPublic =
                    data.isPublicFor &&
                    (data.isPublicFor.includes(FEED_PUBLIC_FOR_ALL) || data.isPublicFor.includes(userId))
                if (!isPublic) {
                    return
                }

                // Check if the observer's specific due date is today or earlier
                const observerDueDate = data.dueDateByObserversIds?.[userId]
                if (observerDueDate && observerDueDate <= dateEndToday) {
                    observedCount++
                }
            })

            const projectData = projectDoc.data()
            return {
                id: projectId,
                name: projectData.name || 'Unnamed Project',
                sortIndex: projectData.sortIndexByUser?.[userId] || 0,
                openTaskCount: reviewerCount + observedCount,
            }
        })

        const projectResults = await Promise.all(projectPromises)

        // Filter out null results and sort like the sidebar (sortIndex desc, then name asc)
        const projects = projectResults
            .filter(p => p !== null)
            .sort((a, b) => {
                // First sort by sortIndex descending
                if (b.sortIndex !== a.sortIndex) {
                    return b.sortIndex - a.sortIndex
                }
                // Then by name ascending (case-insensitive)
                return a.name.toLowerCase().localeCompare(b.name.toLowerCase())
            })
            .map(p => ({
                id: p.id,
                name: p.name,
                openTaskCount: p.openTaskCount,
            }))

        const totalCount = projects.reduce((sum, p) => sum + p.openTaskCount, 0)

        return { projects, totalCount }
    } catch (error) {
        console.error('Error getting open tasks for all projects:', error)
        return null
    }
}

// Optimized context fetching with parallel operations
async function getOptimizedContextMessages(
    messageId,
    projectId,
    objectType,
    objectId,
    language,
    assistantName,
    instructions,
    allowedTools,
    userTimezoneOffset,
    userId,
    assistantId
) {
    // Start all operations in parallel
    const parallelPromises = [
        // Fetch messages
        admin
            .firestore()
            .collection(`chatComments/${projectId}/${objectType}/${objectId}/comments`)
            .orderBy('lastChangeDate', 'desc')
            .limit(10) // Reduced from 50 to improve speed
            .get()
            .then(snapshot => snapshot.docs),
        // Fetch chat/object data to get the topic name
        getChat(projectId, objectId).catch(() => null),
    ]

    // If we need notes context, fetch the specific message in parallel
    if (userId && messageId) {
        parallelPromises.push(
            admin
                .firestore()
                .doc(`chatComments/${projectId}/${objectType}/${objectId}/comments/${messageId}`)
                .get()
                .then(async doc => {
                    if (!doc.exists) return null
                    const commentText = doc.data().commentText
                    const { fetchMentionedNotesContext } = require('./noteContextHelper')
                    return await fetchMentionedNotesContext(commentText, userId, projectId)
                })
                .catch(() => null)
        )
    } else {
        parallelPromises.push(Promise.resolve(null))
    }

    // Fetch open task counts for all projects (including overdue) in parallel
    if (userId) {
        parallelPromises.push(getOpenTasksForAllProjects(userId, userTimezoneOffset))
    } else {
        parallelPromises.push(Promise.resolve(null))
    }

    const [commentDocs, chatData, notesContext, openTasksData] = await Promise.all(parallelPromises)

    // Collect messages from conversation history
    const messages = []
    let amountOfCommentsInContext = 0

    for (let i = 0; i < commentDocs.length; i++) {
        if (amountOfCommentsInContext > 0 || messageId === commentDocs[i].id) {
            const messageData = commentDocs[i].data()
            const { commentText, fromAssistant } = messageData

            if (commentText) {
                const role = fromAssistant ? 'assistant' : 'user'
                const parsedComment = parseTextForUseLiKePrompt(commentText)

                if (!fromAssistant && commentDocs[i].id === messageId) {
                    const imageUrls = extractImageUrlsFromCommentText(commentText)
                    const cleanedComment = parseTextForUseLiKePrompt(cleanTextMetaData(commentText, false, true))
                    messages.push([role, buildMultimodalUserContent(cleanedComment || parsedComment, imageUrls)])
                } else {
                    messages.push([role, parsedComment])
                }
            }
            amountOfCommentsInContext++
            if (amountOfCommentsInContext === 5) break
        }
    }

    // Add base instructions
    await addBaseInstructions(messages, assistantName, language, instructions, allowedTools, userTimezoneOffset, {
        projectId,
        assistantId,
        requestUserId: userId,
    })

    // Add topic/context information if available
    if (chatData && chatData.title) {
        const objectTypeLabel = objectType === 'topics' ? 'chat' : objectType.replace(/s$/, '') // tasks -> task, notes -> note
        messages.push([
            'system',
            `This conversation is about a ${objectTypeLabel} titled: "${parseTextForUseLiKePrompt(chatData.title)}"`,
        ])
    }

    // Add open task counts context if available
    if (openTasksData && openTasksData.projects) {
        const { projects, totalCount } = openTasksData
        console.log('📋 [ASSISTANT CONTEXT] Open tasks for today (including overdue):', {
            userId,
            totalCount,
            projectCount: projects.length,
            projects: projects.map(p => ({ name: p.name, count: p.openTaskCount })),
        })

        // Build the task summary message
        let taskSummary = `The user has ${projects.length} active project${projects.length !== 1 ? 's' : ''}. `
        taskSummary += `Today (including overdue) the user has ${totalCount} open task${
            totalCount !== 1 ? 's' : ''
        } in total.`

        if (projects.length > 0 && totalCount > 0) {
            taskSummary += ` Open tasks per project (in sidebar order): `
            taskSummary += projects.map(p => `"${p.name}": ${p.openTaskCount}`).join(', ')
            taskSummary += '.'
        }

        messages.push(['system', taskSummary])
    }

    const reversedMessages = messages.reverse()

    // Add notes context if available
    if (notesContext && reversedMessages.length > 0) {
        const lastMessageIndex = reversedMessages.length - 1
        if (reversedMessages[lastMessageIndex][0] === 'user') {
            const currentContent = reversedMessages[lastMessageIndex][1]
            if (typeof currentContent === 'string') {
                reversedMessages[lastMessageIndex][1] = currentContent + notesContext
            } else if (Array.isArray(currentContent)) {
                const textPart = currentContent.find(part => part?.type === 'text')
                if (textPart) {
                    textPart.text = (textPart.text || '') + notesContext
                } else {
                    currentContent.unshift({ type: 'text', text: notesContext.trim() })
                }
            }
        }
    }

    return reversedMessages
}

/**
 * Example function showing how internal assistants can use SearchService
 * This function can be called by AI assistants to search for relevant content
 * when answering user questions or performing tasks.
 */
async function searchForAssistant(userId, projectId, query, options = {}) {
    const { type = 'all', dateRange = null, includeContent = false } = options

    try {
        // Initialize SearchService
        const { SearchService } = require('../shared/SearchService')
        const searchService = new SearchService({
            database: admin.firestore(),
            moment: moment,
            enableAlgolia: true,
            enableNoteContent: true,
            enableDateParsing: true,
            isCloudFunction: true,
        })
        await searchService.initialize()

        // Execute search
        const searchResults = await searchService.search(userId, {
            query,
            type,
            projectId,
            dateRange,
        })

        // If includeContent is true, fetch full note content for note results
        if (includeContent && searchResults.results.notes) {
            for (const noteResult of searchResults.results.notes) {
                try {
                    const fullNote = await searchService.getNote(userId, noteResult.id, noteResult.projectId)
                    noteResult.fullContent = fullNote.content
                    noteResult.wordCount = fullNote.metadata.wordCount
                } catch (error) {
                    console.warn(`Could not fetch full content for note ${noteResult.id}:`, error.message)
                }
            }
        }

        return {
            success: true,
            query: searchResults.query,
            parsedQuery: searchResults.parsedQuery,
            results: searchResults.results,
            totalResults: searchResults.totalResults,
            summary: generateSearchSummary(searchResults),
        }
    } catch (error) {
        console.error('Assistant search failed:', error)
        return {
            success: false,
            error: error.message,
            results: {},
            totalResults: 0,
        }
    }
}

/**
 * Generate a human-readable summary of search results for assistants
 */
function generateSearchSummary(searchResults) {
    const { results, totalResults, query } = searchResults
    const summaryParts = []

    if (totalResults === 0) {
        return `No results found for "${query}"`
    }

    Object.entries(results).forEach(([type, items]) => {
        if (items && items.length > 0) {
            const typeLabel = type.charAt(0).toUpperCase() + type.slice(1)
            summaryParts.push(`${items.length} ${typeLabel.toLowerCase()}`)
        }
    })

    const summary = `Found ${totalResults} results for "${query}": ${summaryParts.join(', ')}`

    // Add context about most relevant results
    const allResults = Object.values(results)
        .flat()
        .sort((a, b) => b.score - a.score)
    if (allResults.length > 0) {
        const topResult = allResults[0]
        return `${summary}. Most relevant: ${topResult.title} (${topResult.type})`
    }

    return summary
}

/**
 * Simple validation to log when assistant mentions actions without tool calls
 * This helps with debugging and monitoring
 */
function validateToolCallConsistency(commentText) {
    try {
        // Check if the assistant mentioned actions without actually calling tools
        const mentionedActions = []
        const intentPatterns = [
            /(?:I will|I'll|let me|I'm going to)\s+(create|make|add|update|get|retrieve|find)\s+(?:a\s+)?(task|note|tasks)/gi,
            /(?:creating|making|adding|updating|getting|retrieving|finding)\s+(?:a\s+)?(task|note|tasks)/gi,
        ]

        intentPatterns.forEach(pattern => {
            const matches = commentText.matchAll(pattern)
            for (const match of matches) {
                mentionedActions.push(match[0])
            }
        })

        // Check if there are already tool calls in the text
        const hasToolCalls = /TOOL:\s*\w+\s*\{/.test(commentText)

        if (mentionedActions.length > 0 && !hasToolCalls) {
            console.warn('🔍 TOOL VALIDATION: Assistant mentioned actions without tool calls:', {
                mentionedActions,
                commentText: commentText.substring(0, 200) + '...',
            })
        } else if (mentionedActions.length > 0 && hasToolCalls) {
            console.log('🔍 TOOL VALIDATION: Assistant mentioned actions with tool calls - OK')
        }
    } catch (error) {
        console.error('🔍 TOOL VALIDATION: Error in validation:', error)
    }
}

/**
 * Process tool results through LLM for intelligent analysis and formatting
 */
// processToolResultWithLLM function removed - native tool calling only

module.exports = {
    COMPLETION_MAX_TOKENS,
    storeBotAnswerStream,
    replaceUserNameByMention,
    addSpaceToUrl,
    interactWithChatStream,
    getAssistantForChat,
    addBaseInstructions,
    parseTextForUseLiKePrompt,
    ENCODE_MESSAGE_GAP,
    reduceGoldWhenChatWithAI,
    getTaskOrAssistantSettings,
    searchForAssistant,
    generateSearchSummary,
    getCommonData, // Export for parallel fetching to reduce time-to-first-token
    normalizeModelKey, // Export for model normalization and backward compatibility
    calculateGoldCostFromTokens,
    executeToolNatively, // Export for WhatsApp assistant bridge
    isToolAllowedForExecution,
    // Optimized functions with caching
    getCachedEnvFunctions,
    getOpenAIClient,
    getOptimizedContextMessages,
    getMaxTokensForModel,
    getMessageTextForTokenCounting,
    buildMultimodalUserContent,
    collectAssistantTextWithToolCalls,
}
