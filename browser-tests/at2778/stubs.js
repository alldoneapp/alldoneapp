export default function Empty() {
    return null
}
export const getTimestampInMilliseconds = v => v
export const getAnnaWorkspaceWorkState = () => ({})
export const getUserPresentationData = () => ({ displayName: 'Anna' })
export const RAMBLE_PHASE_IDLE = 'idle'
export const isDictationSupported = () => false
export const createBotQuickTopic = async () => ({ chatId: 'today', projectId: 'p1', assistantId: 'a1' })
export const CHAT_INPUT_LIMIT_IN_CHARACTERS = 10000
export const runHttpsCallableFunction = async name => {
    if (name === 'startAssistantBrowserCallSecondGen') {
        await new Promise((resolve, reject) => {
            window.answer = resolve
            window.fail = reject
        })
        return { sessionId: 'test', answerSdp: 'fixture', voiceProvider: 'gpt-live' }
    }
    return name === 'getAssistantBrowserCallSummarySecondGen' ? {} : { settled: true }
}

export const isBrowserOffline = () => false
