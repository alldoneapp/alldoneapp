// Synthetic account/server. The history/message/draft hooks, localStorage,
// loading ownership, connectivity and shared page lifecycle are production code.
import { createStore } from 'redux'
import { getAnnaHistoryWindow } from '../../functions/Assistant/annaHistoryWindow'

export const user = { uid: 'demo', defaultProjectId: 'p1', projectIds: ['p1'], timezone: 'Europe/Berlin' }
const store = createStore((state = { loggedUser: user, connectionState: '' }, action) => ({
    ...state,
    ...action.patch,
}))
export default store
export const setConnectionState = connectionState => ({ type: 'connection', patch: { connectionState } })
export const setAssistantEnabled = () => ({ type: 'unused' })
export const setNotEnabledAssistantWhenLoadComments = setAssistantEnabled
export const setShowNotificationAboutTheBotBehavior = setAssistantEnabled
export const getAssistant = () => null
export const handleAppResume = async () => {}
export const runBootIntegrityCheck = async () => {}
export const commentOutbox = { list: () => [] }
export const subscribeCommentOutbox = () => () => {}

const windowDates = getAnnaHistoryWindow(user)
const chatFor = dateKey => ({
    id: `AnnaChat${dateKey}demo`,
    chatId: `AnnaChat${dateKey}demo`,
    projectId: 'p1',
    assistantId: 'a1',
    annaOwnerId: 'demo',
    creatorId: 'demo',
    type: 'topics',
    dateKey,
    created: dateKey === windowDates.today ? Date.now() : windowDates.start,
})
export const today = chatFor(windowDates.today)
const yesterday = chatFor(windowDates.yesterday)
const threads = [yesterday, today]
const comments = new Map(
    threads.map(thread => [
        thread.id,
        Array.from({ length: 60 }, (_, index) => ({
            id: `m${index}`,
            created: thread.created + index,
            commentText: `${thread.dateKey} message ${index}`,
            creatorId: 'demo',
        })),
    ])
)
const watchers = new Map()
const pending = []
let hold = new URLSearchParams(location.search).has('hold')
window.__calls = []
export const runHttpsCallableFunction = async (name, request) => {
    window.__calls.push({ name, request })
    if (!navigator.onLine) throw Object.assign(new Error('Offline'), { code: 'offline' })
    if (hold) await new Promise(resolve => pending.push(resolve))
    return request.historyOnly
        ? { threads, nextBefore: { created: windowDates.start } }
        : { ...today, conversation: today, nextRolloverAt: windowDates.end }
}
export const getDb = () => ({
    doc: path => ({
        onSnapshot: (...args) => {
            const next = args.find(value => typeof value === 'function')
            const emit = () => {
                if (hold || !navigator.onLine) return
                const data = path.includes('/chats/') ? today : { ...today, chatId: today.id }
                next({ exists: true, data: () => data, metadata: { fromCache: false } })
            }
            watchers.set(path, emit)
            emit()
            return () => watchers.delete(path)
        },
    }),
})
export const watchComments = (_project, _type, id, key, limit, next) => {
    const emit = () => {
        if (hold || !navigator.onLine) return
        next((comments.get(id) || []).slice(-limit), { fromCache: false })
    }
    watchers.set(key, emit)
    if (!navigator.onLine) next([], { fromCache: true })
    emit()
}
export const unwatch = key => watchers.delete(key)
window.__release = () => {
    hold = false
    pending.splice(0).forEach(resolve => resolve())
    watchers.forEach(emit => emit())
}
window.__replaceToday = text => {
    comments.set(today.id, text ? [{ id: 'replacement', created: Date.now(), commentText: text }] : [])
    watchers.forEach(emit => emit())
}
window.__switchAccount = () => store.dispatch({ type: 'account', patch: { loggedUser: { ...user, uid: 'other' } } })
