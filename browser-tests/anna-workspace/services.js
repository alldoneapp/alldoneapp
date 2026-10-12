// Synthetic account and transport only; the shell, chat, browser pane, hooks and CSS are real.
export * from '../at2718/dependencies'
import { useSyncExternalStore } from 'react'
import { getResponsiveLayoutState } from '../../utils/responsiveLayout'
import { getWorkspaceViewport, WORKSPACE_VIEWPORT_EVENT } from '../../utils/workspaceViewport'
import { DV_TAB_NOTE_EDITOR } from '../../utils/TabNavigationConstants'
import { getAnnaHistoryWindow } from '../../functions/Assistant/annaHistoryWindow'
export const useDispatch = () => () => {}
const user = { uid: 'demo', displayName: 'Alex', defaultProjectId: 'p1', gold: 1000 }
const assistant = { uid: 'a1', displayName: 'Carl Code Mentor' }
const dateKey = getAnnaHistoryWindow(user).today
const chat = {
    id: `AnnaChat${dateKey}demo`,
    assistantId: 'a1',
    projectId: 'p1',
    isPublicFor: [0],
    annaOwnerId: 'demo',
    creatorId: 'demo',
    type: 'topics',
    created: Date.now(),
}
const data = {
    [`chatObjects/p1/chats/${chat.id}`]: chat,
    'users/demo/private/annaConversation': { projectId: 'p1', chatId: chat.id, assistantId: 'a1' },
    'feedsObjectsLastStates/p1/tasks/task1': { name: 'Discuss the visit with Daniela' },
    'chatObjects/p1/chats/chat1': { title: 'Sprint planning', type: 'tasks' },
    'chatComments/p1/tasks/chat1/comments/message1': {
        creatorId: 'a1',
        fromAssistant: true,
        commentText: '**Review finished.** Two decisions need your input before we can release the next version.',
    },
}
const listeners = new Map()
let activityState = { sidebarNumbers: { p1: { demo: 20 } }, followedFeedsData: {}, projectChatNotifications: {} }
let activityRevision = 0
const activityListeners = new Set()
const subscribeActivity = callback => {
    activityListeners.add(callback)
    return () => activityListeners.delete(callback)
}
window.__annaActivity = patch => {
    activityState = { ...activityState, ...patch }
    activityRevision++
    activityListeners.forEach(callback => callback())
}
const subscribeState = callback => {
    const unsubscribe = subscribeActivity(callback)
    window.addEventListener('resize', callback)
    window.addEventListener(WORKSPACE_VIEWPORT_EVENT, callback)
    return () => {
        unsubscribe()
        window.removeEventListener('resize', callback)
        window.removeEventListener(WORKSPACE_VIEWPORT_EVENT, callback)
    }
}
const getState = () => {
    const viewport = getWorkspaceViewport()
    return {
        loggedUser: user,
        loggedUserProjects: [{ id: 'p1', name: 'Launch' }],
        defaultAssistant: assistant,
        globalAssistants: [assistant],
        connectionState: new URLSearchParams(window.location.search).has('floating') ? 'offline' : 'online',
        smallScreenNavigation: (window.__alldoneWorkspaceViewport?.width || window.innerWidth) < 640,
        ...(new URLSearchParams(window.location.search).has('noteWidth')
            ? getResponsiveLayoutState({
                  width: viewport.width,
                  preferCompactNavigation: viewport.active,
                  route: 'NotesDetailedView',
              })
            : {}),
        assignee: user,
        selectedNavItem: DV_TAB_NOTE_EDITOR,
        showLoadingDataSpinner: new URLSearchParams(window.location.search).has('floating'),
        ...activityState,
    }
}
export const useSelector = selector => {
    useSyncExternalStore(
        subscribeState,
        () => `${activityRevision}:${getWorkspaceViewport().width}:${getWorkspaceViewport().active}`
    )
    return selector(getState())
}
// The explicit extension bypasses this harness's TranslationService replacement.
// Exercise real locale lookups instead of hiding missing keys with a key echo.
import { translate as translateReal, setLanguage } from '../../i18n/TranslationService.js'
setLanguage(new URLSearchParams(window.location.search).get('language') || 'en')
export const translate = translateReal
export const useTranslator = () => {}
export const respondToVmInteraction = request => runHttpsCallableFunction('respondToVmInteractionSecondGen', request)
export const cancelAssistantRun = request => runHttpsCallableFunction('cancelAssistantRunSecondGen', request)
export const useVoiceCall = () => ({ status: 'idle', voiceSeconds: 0 })
export const getAssistant = () => assistant
export const subscribePageVisible = () => () => {}
export const subscribePageHidden = () => () => {}
export const STAYWARD_COMMENT = 'stayward'
export const VIDEO_TRIGGER = 'ptPQsef7OeB5eWd'
// Model successful storage without uploading fixture files to a real project.
export const updateNewAttachmentsData = async (_projectId, text) =>
    text
        .split(' ')
        .map(word => {
            const trigger = word.match(/^(EbDsQTD14ahtSR5|O2TI5plHBf1QfdY|ptPQsef7OeB5eWd)/)?.[0]
            if (!trigger) return word
            const parts = word.split(trigger)
            if (parts.at(-1) !== '1') return word
            const uri = `https://fixture.invalid/${encodeURIComponent(parts.at(-2))}`
            return [...parts.slice(0, -1).map(part => (part.startsWith('blob:') ? uri : part)), '0'].join(trigger)
        })
        .join(' ')
export const CHAT_INPUT_LIMIT_IN_CHARACTERS = 10000
export const getTimestampInMilliseconds = value => value
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
export const getId = () => `sent-${++messageSequence}`
export const createObjectMessage = async (projectId, chatId, text, ...options) => {
    const metadata = options.at(-1)
    const id = metadata?.id || getId()
    pendingMessages.set(id, {
        id,
        projectId,
        chatId,
        commentText: text,
        creatorId: user.uid,
        created: metadata?.created || Date.now(),
    })
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
        onSnapshot: (...args) => {
            const callback = args.find(value => typeof value === 'function')
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
                listPath: '/projects/p1/user/a1/tasks/open',
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
            // Let the browser test verify the running state before completing;
            // screenshots and slow CI must not race a fixed completion timeout.
            await new Promise(resolve => {
                window.__annaCompleteRequest = resolve
            })
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
    const history = { threads: [{ ...chat, chatId: chat.id, dateKey }], nextBefore: null }
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
    getState,
    subscribe: subscribeState,
    accessGranted: () => true,
    dispatch: () => {},
    createNavigationProp: () => ({}),
    processUrl: async (_, path) => {
        const url = new URL(path, window.location.origin)
        for (const [key, value] of new URLSearchParams(window.location.search)) url.searchParams.set(key, value)
        history.pushState(null, '', url)
        workspaceListeners.forEach(callback => callback())
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
