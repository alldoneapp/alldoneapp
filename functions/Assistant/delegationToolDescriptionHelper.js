const admin = require('firebase-admin')
const crypto = require('crypto')

const { GLOBAL_PROJECT_ID } = require('../Firestore/assistantsFirestore')
const { getCachedEnvFunctions, getOpenAIClient } = require('./assistantHelper')

const MAX_GENERATED_DESCRIPTION_LENGTH = 420
const MAX_TASK_EXAMPLES = 50

function normalizeText(value, maxLength = 240) {
    return String(value || '')
        .trim()
        .replace(/\s+/g, ' ')
        .slice(0, maxLength)
}

function normalizeTaskType(type) {
    const cleanType = normalizeText(type, 40).toLowerCase()
    if (['prompt', 'link', 'iframe', 'webhook'].includes(cleanType)) return cleanType
    return 'other'
}

function getOpenAIModelFromAssistantModel(modelKey) {
    // Keep mapping aligned with assistant runtime model keys.
    if (modelKey === 'MODEL_GPT3_5') return 'gpt-3.5-turbo'
    if (modelKey === 'MODEL_GPT4') return 'gpt-4'
    if (modelKey === 'MODEL_GPT4O') return 'gpt-4o'
    if (modelKey === 'MODEL_GPT5_1' || modelKey === 'MODEL_GPT5') return 'gpt-5.1'
    if (modelKey === 'MODEL_GPT5_5') return 'gpt-5.5'
    if (modelKey === 'MODEL_GPT5_4_MINI') return 'gpt-5.4-mini'
    if (modelKey === 'MODEL_GPT5_4_NANO') return 'gpt-5.4-nano'
    if (modelKey === 'MODEL_GPT5_2') return 'gpt-5.2'
    if (modelKey === 'MODEL_SONAR') return 'sonar'
    if (modelKey === 'MODEL_SONAR_PRO') return 'sonar-pro'
    if (modelKey === 'MODEL_SONAR_REASONING') return 'sonar-reasoning'
    if (modelKey === 'MODEL_SONAR_REASONING_PRO') return 'sonar-reasoning-pro'
    if (modelKey === 'MODEL_SONAR_DEEP_RESEARCH') return 'sonar-deep-research'
    return 'gpt-5.5'
}

function getTaskExecutionDescriptor(task) {
    const type = normalizeTaskType(task?.type)
    if (type === 'prompt') {
        return normalizeText(task?.prompt, 200)
    }
    if (type === 'link' || type === 'iframe') {
        return normalizeText(task?.link, 200)
    }
    if (type === 'webhook') {
        return normalizeText(task?.taskMetadata?.webhookUrl, 200)
    }
    return normalizeText(task?.prompt || task?.link || '', 200)
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

function normalizeDelegationTask(task) {
    const type = normalizeTaskType(task?.type)
    return {
        id: normalizeText(task?.id, 120),
        name: normalizeText(task?.name || task?.title || 'Unnamed task', 120),
        type,
        executionDescriptor: getTaskExecutionDescriptor(task),
    }
}

async function collectAssistantDelegationInputs(projectId, assistantId) {
    const db = admin.firestore()
    const assistantRef = db.doc(`assistants/${projectId}/items/${assistantId}`)
    const assistantDoc = await assistantRef.get()
    if (!assistantDoc.exists) {
        throw new Error('Assistant not found')
    }

    const assistantData = assistantDoc.data() || {}
    const tasks = await getAssistantPreConfigTaskDocs(projectId, assistantId)
    const normalizedTasks = tasks.map(normalizeDelegationTask)

    return {
        projectId,
        assistantId,
        assistantRef,
        assistant: {
            displayName: normalizeText(assistantData.displayName, 120),
            description: normalizeText(assistantData.description, 220),
            model: normalizeText(assistantData.model, 80),
            delegationToolDescriptionManual: normalizeText(assistantData.delegationToolDescriptionManual, 1000),
            delegationToolDescriptionGenerated: normalizeText(assistantData.delegationToolDescriptionGenerated, 1000),
            delegationToolDescriptionGeneratedAt: assistantData.delegationToolDescriptionGeneratedAt || null,
            delegationToolDescriptionInputHash: normalizeText(assistantData.delegationToolDescriptionInputHash, 120),
        },
        tasks: normalizedTasks,
    }
}

function buildDelegationInputHash(inputs) {
    const canonicalTasks = [...(inputs?.tasks || [])]
        .sort((a, b) => `${a.type}:${a.name}:${a.id}`.localeCompare(`${b.type}:${b.name}:${b.id}`))
        .map(task => ({
            type: task.type,
            name: task.name,
            executionDescriptor: task.executionDescriptor,
        }))

    const canonicalPayload = {
        assistantDisplayName: normalizeText(inputs?.assistant?.displayName, 120),
        assistantDescription: normalizeText(inputs?.assistant?.description, 220),
        tasks: canonicalTasks,
    }
    return crypto.createHash('sha1').update(JSON.stringify(canonicalPayload)).digest('hex')
}

function buildFallbackDelegationDescription(inputs) {
    const assistantName = normalizeText(inputs?.assistant?.displayName, 120) || 'Assistant'
    const assistantDescription = normalizeText(inputs?.assistant?.description, 220)
    const taskExamples = (Array.isArray(inputs?.tasks) ? inputs.tasks : [])
        .filter(task => task.name)
        .slice(0, MAX_TASK_EXAMPLES)
        .map(task => `"${task.name}"`)

    const taskSummary =
        taskExamples.length > 0
            ? `Useful for tasks such as ${taskExamples.join(', ')}.`
            : 'Best for project-specific requests that may require tool execution.'

    const descriptionLine = assistantDescription ? ` Focus: ${assistantDescription}.` : ''
    return normalizeText(
        `Delegate to ${assistantName}.${descriptionLine} ${taskSummary}`,
        MAX_GENERATED_DESCRIPTION_LENGTH
    )
}

function buildDelegationCapabilitiesSummaryFromTasks(tasks) {
    const seen = new Set()
    const taskNames = []

    ;(Array.isArray(tasks) ? tasks : []).forEach(task => {
        const rawName = normalizeText(task?.name, 80)
        if (!rawName) return
        const dedupeKey = rawName.toLowerCase()
        if (seen.has(dedupeKey)) return
        seen.add(dedupeKey)
        taskNames.push(rawName)
    })

    if (taskNames.length === 0) return ''

    const examples = taskNames
        .slice(0, 5)
        .map(name => `"${name.replace(/"/g, "'")}"`)
        .join(', ')
    const remainingCount = taskNames.length - Math.min(taskNames.length, 5)

    return remainingCount > 0
        ? `Can help with pre-config tasks like ${examples}, and ${remainingCount} more.`
        : `Can help with pre-config tasks like ${examples}.`
}

function buildLegacyDelegationToolDescription({
    displayName,
    projectName,
    projectId,
    assistantDescription,
    capabilitiesSummary,
}) {
    const safeDisplayName = normalizeText(displayName, 120) || 'Assistant'
    const safeProjectName = normalizeText(projectName || projectId, 120) || projectId
    const safeProjectId = normalizeText(projectId, 120)
    const safeAssistantDescription = normalizeText(assistantDescription, 180)
    const safeCapabilitiesSummary = normalizeText(capabilitiesSummary, 260)

    return (
        `Delegate work to assistant "${safeDisplayName}" in project "${safeProjectName}" ` +
        `(project ID: "${safeProjectId}"). ` +
        `${safeAssistantDescription ? `Assistant description: ${safeAssistantDescription}. ` : ''}` +
        `${safeCapabilitiesSummary ? `${safeCapabilitiesSummary} ` : ''}` +
        'Pass a clear instruction. The assistant will execute with its own enabled tools and return the result.'
    )
}

function getLanguageLabel(languageCode) {
    const normalized = normalizeText(languageCode, 12).toLowerCase()
    if (!normalized) return 'English'
    if (normalized.startsWith('es')) return 'Spanish'
    if (normalized.startsWith('de')) return 'German'
    if (normalized.startsWith('fr')) return 'French'
    if (normalized.startsWith('pt')) return 'Portuguese'
    return 'English'
}

function extractTextFromCompletionMessage(message) {
    if (!message) return ''
    if (typeof message.content === 'string') return normalizeText(message.content, MAX_GENERATED_DESCRIPTION_LENGTH)
    if (!Array.isArray(message.content)) return ''

    const text = message.content
        .map(part => (part?.type === 'text' && part?.text ? part.text : ''))
        .filter(Boolean)
        .join(' ')
    return normalizeText(text, MAX_GENERATED_DESCRIPTION_LENGTH)
}

async function generateDelegationDescription(inputs, languageCode = 'en') {
    const fallbackText = buildFallbackDelegationDescription(inputs)

    try {
        const env = getCachedEnvFunctions()
        const openAiKey = env?.OPEN_AI_KEY
        if (!openAiKey) return fallbackText

        const assistantName = normalizeText(inputs?.assistant?.displayName, 120) || 'Assistant'
        const assistantDescription = normalizeText(inputs?.assistant?.description, 260)
        const taskLines = (Array.isArray(inputs?.tasks) ? inputs.tasks : [])
            .slice(0, MAX_TASK_EXAMPLES)
            .map(
                task =>
                    `- [${task.type}] ${task.name}${task.executionDescriptor ? ` -> ${task.executionDescriptor}` : ''}`
            )
            .join('\n')
        const languageLabel = getLanguageLabel(languageCode)

        const openai = getOpenAIClient(openAiKey)
        const selectedModel = getOpenAIModelFromAssistantModel(inputs?.assistant?.model)
        const completion = await openai.chat.completions.create({
            model: selectedModel,
            temperature: 0.2,
            messages: [
                {
                    role: 'system',
                    content:
                        'Write concise delegation tool descriptions for LLM function calling. Return plain text only, no markdown, no bullets.',
                },
                {
                    role: 'user',
                    content:
                        `Write one short description (max 320 chars) in ${languageLabel} to help another LLM decide when to delegate.\n` +
                        'First describe the assistant in a general role-oriented way (for example: personal assistant, designer, analyst).\n' +
                        'Then mention pre-configured tasks only as examples of what it can do, not as the full definition.\n' +
                        `Assistant name: ${assistantName}\n` +
                        `Assistant description: ${assistantDescription || 'N/A'}\n` +
                        `Pre-configured tasks examples:\n${taskLines || '- none'}\n` +
                        'Style requirements: action-oriented, selection-focused, truthful, no hype, no emojis.',
                },
            ],
        })

        const generated = extractTextFromCompletionMessage(completion?.choices?.[0]?.message)
        return generated || fallbackText
    } catch (error) {
        console.warn('Delegation description generation failed, using fallback:', error.message)
        return fallbackText
    }
}

function getEffectiveDelegationDescriptionSource(assistantData = {}) {
    const manual = normalizeText(assistantData.delegationToolDescriptionManual, 1000)
    if (manual) return 'manual'
    return 'assistant_description_fallback'
}

module.exports = {
    collectAssistantDelegationInputs,
    buildDelegationInputHash,
    generateDelegationDescription,
    buildDelegationCapabilitiesSummaryFromTasks,
    buildLegacyDelegationToolDescription,
    getEffectiveDelegationDescriptionSource,
    normalizeText,
}
