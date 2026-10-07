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
import translations from '../../i18n/translations/en.json'
export const translate = (text, values = {}) =>
    (text.startsWith('vm_workspace_') ? translations[text] || text : text).replace(
        /%{(\w+)}/g,
        (_, key) => values[key] ?? ''
    )
export const useTranslator = () => {}
export const respondToVmInteraction = request => runHttpsCallableFunction('respondToVmInteractionSecondGen', request)
export const cancelAssistantRun = request => runHttpsCallableFunction('cancelAssistantRunSecondGen', request)
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
    if (name === 'processRambleSecondGen') {
        window.__annaDictationRequest = request
        return new Promise(resolve => {
            window.__annaFinishDictation = text => resolve({ text })
        })
    }
    if (name === 'annaBrowserWorkspaceSecondGen') return { control: 'assistant', ready: true }
    if (name === 'listActiveVmJobsSecondGen')
        return {
            jobs: new URLSearchParams(window.location.search).has('vm')
                ? vmJobs.filter(job => job.status !== 'completed' || job.id === request.selectedRunId)
                : [],
        }
    if (name === 'respondToVmInteractionSecondGen') {
        window.__annaVmFixture('running', '💻 npm test\nTests are running…')
        return {}
    }
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

const vmJobs = [
    {
        id: 'vm1',
        projectId: 'p1',
        objectId: 't1',
        objectType: 'tasks',
        title: 'Prepare the launch report',
        projectName: 'Launch',
        model: 'Claude Code',
        commentId: 'vm-comment',
        status: 'initiated',
    },
    {
        id: 'vm2',
        projectId: 'p1',
        objectId: 't2',
        objectType: 'tasks',
        title: 'Review the mobile experience',
        projectName: 'Product',
        model: 'Codex',
        commentId: 'vm-comment2',
        status: 'pending',
    },
]
window.__annaVmFixture = (
    status = 'running',
    commentText = '📄 Reading launch.md\n💬 Preparing the launch report…'
) => {
    vmJobs[0].status = status === 'running' ? 'initiated' : status
    return getDb()
        .doc('chatComments/p1/tasks/t1/comments/vm-comment')
        .set({
            commentText,
            isLoading: ['running', 'awaiting_user'].includes(status),
            assistantRun: {
                kind: 'vm_job',
                runId: 'vm1',
                requestUserId: 'demo',
                status,
                ...(status === 'awaiting_user'
                    ? {
                          interaction: {
                              requestId: 'ask1',
                              kind: 'plan_review',
                              title: 'Review plan',
                              plan: 'Run the tests',
                          },
                      }
                    : {}),
            },
        })
}
window.__annaVmFixture()
window.__annaBrowserFixture = async (status, commentId = 'browse1') => {
    await getDb()
        .doc(`chatComments/p1/topics/${chat.id}/comments/${commentId}`)
        .set({
            assistantRun: { kind: 'chat', status },
            isLoading: status === 'running',
        })
    await getDb()
        .doc('users/demo/private/annaBrowser')
        .set({
            runId: 'brun_fixture',
            title: 'Browsing an example website',
            url: 'https://example.test',
            updatedAt: Date.now(),
            activity: { projectId: 'p1', objectId: chat.id, objectType: 'topics', commentId },
        })
}
export default {
    getState: () => ({ loggedUser: user }),
    dispatch: () => {},
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

const approvalListeners = new Set()
export const watchBrowserApprovals = (projectId, objectId, userId, callback) => {
    approvalListeners.add(callback)
    callback([
        {
            approvalId: 'login1',
            runId: 'brun_fixture',
            category: 'login',
            assistantCommentId: 'm2',
            message: 'Sign in to continue',
            hostname: 'example.test',
        },
    ])
    return () => approvalListeners.delete(callback)
}
export const respondToBrowserApproval = async () => ({ status: 'denied' })
export const interactWithBrowserTakeover = async ({ action }) => {
    console.info(`Anna fixture login action: ${action}`)
    return {
        viewport: { width: 1280, height: 900 },
        screenshotDataUrl:
            'data:image/svg+xml;charset=utf-8,' +
            encodeURIComponent(
                '<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="900"><rect width="1280" height="900" fill="#f5f6f8"/><rect x="340" y="170" width="600" height="530" rx="20" fill="white"/><text x="410" y="270" font-family="Arial" font-size="36" fill="#15243b">Sign in to Alldone</text><rect x="410" y="350" width="460" height="70" rx="8" fill="#e8edf5"/><text x="430" y="395" font-family="Arial" font-size="24" fill="#5e6c80">Password</text></svg>'
            ),
        title: 'Sign in to Alldone',
        focused: { inputType: 'password', name: 'Password' },
        goldCost: 1,
    }
}
export const finishBrowserTakeover = async ({ cancelled }) => {
    console.info(`Anna fixture login finished: ${cancelled ? 'cancelled' : 'completed'}`)
    approvalListeners.forEach(callback => callback([]))
    return { success: true }
}
