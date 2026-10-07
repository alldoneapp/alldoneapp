// Synthetic account and transport only; the shell, chat, browser pane, hooks and CSS are real.
const user = { uid: 'demo', displayName: 'Alex', defaultProjectId: 'p1', gold: 1000 }
const assistant = { uid: 'a1', displayName: 'Carl Code Mentor' }
const chat = {
    id: 'AnnaChat20261007demo',
    assistantId: 'a1',
    projectId: 'p1',
    isPublicFor: [0],
    annaOwnerId: 'demo',
    creatorId: 'demo',
    type: 'topics',
    created: 1,
}
const data = {
    'chatObjects/p1/chats/AnnaChat20261007demo': chat,
    'users/demo/private/annaConversation': { projectId: 'p1', chatId: chat.id, assistantId: 'a1' },
}
const listeners = new Map()
export const useSelector = selector =>
    selector({
        loggedUser: user,
        defaultAssistant: assistant,
        connectionState: 'offline',
        smallScreenNavigation: (window.__alldoneWorkspaceViewport?.width || window.innerWidth) < 640,
    })
export const translate = (text, values = {}) => text.replace(/%{(\w+)}/g, (_, key) => values[key] ?? '')
export const useTranslator = () => {}
export const useVoiceCall = () => ({ status: 'idle', voiceSeconds: 0 })
export const getAssistant = () => assistant
export const subscribePageVisible = () => () => {}
export const subscribePageHidden = () => () => {}
export const STAYWARD_COMMENT = 'stayward'
export const CHAT_INPUT_LIMIT_IN_CHARACTERS = 10000
export const getTimestampInMilliseconds = value => value
export const resolveEffectiveMessageLoading = () => false
let messageSequence = 0
const pendingMessages = new Map()
const messageListeners = new Set()
const savedMessages = []
const failedRuns = new Set()
const workspaceTasks = []
const workspaceListeners = new Set()
export const getWorkspaceTasks = () => workspaceTasks
export const subscribeWorkspaceTasks = callback => {
    workspaceListeners.add(callback)
    return () => workspaceListeners.delete(callback)
}
const delay = ms => new Promise(resolve => setTimeout(resolve, ms))
export const getSavedMessages = () => savedMessages
export const subscribeMessages = listener => {
    messageListeners.add(listener)
    return () => messageListeners.delete(listener)
}
export const createObjectMessage = async (projectId, chatId, text) => {
    const id = `sent-${++messageSequence}`
    pendingMessages.set(id, { id, projectId, chatId, commentText: text, creatorId: user.uid, created: Date.now() })
    return id
}
export const commentOutbox = {
    read: (_, id) => pendingMessages.get(id),
    retry: async (_, id) => {
        const message = pendingMessages.get(id)
        if (!message) return
        if (new URLSearchParams(window.location.search).has('slowSending')) await delay(1200)
        savedMessages.push(message)
        pendingMessages.delete(id)
        messageListeners.forEach(listener => listener())
    },
}
export const getDb = () => ({
    runTransaction: fn => fn({ get: ref => ref.get(), set: (ref, patch) => ref.set(patch) }),
    doc: path => ({
        get: async () => ({ exists: !!data[path], data: () => data[path] }),
        onSnapshot: callback => {
            listeners.set(path, callback)
            callback({ exists: !!data[path], data: () => data[path] })
            return () => listeners.delete(path)
        },
        update: async patch => {
            data[path] = { ...data[path], ...patch }
            listeners.get(path)?.({ exists: true, data: () => data[path] })
        },
        set: async patch => {
            data[path] = { ...data[path], ...patch }
            listeners.get(path)?.({ exists: true, data: () => data[path] })
            if (path === 'users/demo/private/annaWorkspace' && patch.control)
                console.info(`Anna fixture workspace control: ${patch.control}`)
        },
    }),
})
export const runHttpsCallableFunction = async (name, request = {}) => {
    if (name === 'askToBotSecondGen') {
        const message = savedMessages.find(item => item.id === request.messageId)
        if (message?.commentText === 'Create a task for the launch') {
            const response = {
                id: `response-${request.messageId}`,
                projectId: request.projectId,
                chatId: request.objectId,
                creatorId: assistant.uid,
                fromAssistant: true,
                created: Date.now(),
                isLoading: true,
                commentText: 'Creating the task…',
                assistantRun: { triggerMessageId: request.messageId, status: 'running' },
            }
            savedMessages.push(response)
            messageListeners.forEach(listener => listener())
            const id = `created-${workspaceTasks.length + 1}`
            const cue = {
                id,
                triggerMessageId: request.messageId,
                objectId: id,
                type: 'task',
                projectId: 'p1',
                change: 'created',
                path: `/projects/p1/tasks/${id}/properties`,
                expiresAt: Date.now() + 120000,
            }
            const chatPath = `chatObjects/p1/chats/${chat.id}`
            // The conversation signal can reach the browser before the list listener.
            await getDb()
                .doc(chatPath)
                .update({ annaWorkspaceChanges: [...(data[chatPath].annaWorkspaceChanges || []), cue] })
            setTimeout(() => {
                workspaceTasks.push({ id, title: 'Prepare the launch checklist' })
                workspaceListeners.forEach(callback => callback())
            }, 250)
            await delay(5500)
            response.isLoading = false
            response.commentText = 'The task is ready.'
            response.assistantRun.status = 'completed'
            messageListeners.forEach(listener => listener())
        }
        if (new URLSearchParams(window.location.search).has('slowSending')) {
            await delay(2500)
            if (request.messageId === 'sent-1' && !failedRuns.has(request.messageId)) {
                failedRuns.add(request.messageId)
                throw new Error('Connection interrupted')
            }
        }
        return {}
    }
    if (name !== 'getAnnaConversationSecondGen') return {}
    if (new URLSearchParams(window.location.search).has('slowConversation'))
        await new Promise(resolve => setTimeout(resolve, 6000))
    const history = { threads: [{ ...chat, chatId: chat.id, dateKey: '20261007' }], nextBefore: null }
    if (request.historyOnly) return history
    console.info('Anna fixture conversation validated')
    return {
        chatId: chat.id,
        projectId: 'p1',
        assistantId: 'a1',
        conversation: chat,
        nextRolloverAt: Date.now() + 86400000,
        ...(request.includeHistory === false ? {} : history),
    }
}
export default {
    createNavigationProp: () => ({}),
    processUrl: async (_, path) => {
        const url = new URL(path, window.location.origin)
        for (const [key, value] of new URLSearchParams(window.location.search)) url.searchParams.set(key, value)
        history.pushState(null, '', url)
        document.title = 'Assistant tasks | Alldone'
        console.info(`Anna fixture navigation: ${path}`)
    },
}

export const getUserPresentationData = id => (id === 'a1' ? { ...assistant, isAssistant: true } : user)
