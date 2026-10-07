// Synthetic account and transport only; the shell, chat, browser pane, hooks and CSS are real.
const user = { uid: 'demo', displayName: 'Alex', defaultProjectId: 'p1', gold: 1000 }
const assistant = { uid: 'a1', displayName: 'Anna Alldone' }
const chat = { id: 'AnnaChat20261007demo', assistantId: 'a1', projectId: 'p1', isPublicFor: [0] }
const data = { 'chatObjects/p1/chats/AnnaChat20261007demo': chat }
const listeners = new Map()
export const useSelector = selector => selector({ loggedUser: user, defaultAssistant: assistant })
export const translate = text => text
export const useTranslator = () => {}
export const useVoiceCall = () => ({ status: 'idle', voiceSeconds: 0 })
export const getAssistant = () => assistant
export const subscribePageVisible = () => () => {}
export const STAYWARD_COMMENT = 'stayward'
export const CHAT_INPUT_LIMIT_IN_CHARACTERS = 10000
export const getTimestampInMilliseconds = value => value
export const resolveEffectiveMessageLoading = () => false
export const createObjectMessage = async () => 'new-message'
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
        },
    }),
})
export const runHttpsCallableFunction = async name =>
    name === 'getAnnaConversationSecondGen'
        ? {
              ...chat,
              chatId: chat.id,
              nextRolloverAt: Date.now() + 86400000,
              threads: [{ ...chat, chatId: chat.id, created: 1, dateKey: '20261007' }],
              nextBefore: null,
          }
        : {}
export default {
    createNavigationProp: () => ({}),
    processUrl: async (_, path) => {
        history.pushState(null, '', path)
        document.title = 'Assistant tasks | Alldone'
    },
}

export const getUserPresentationData = id => (id === 'a1' ? { ...assistant, isAssistant: true } : user)
