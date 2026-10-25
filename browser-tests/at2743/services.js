// Synthetic account, transport and microphone only. Both composers, Quill, avatar,
// attachment selector, dictation and voice/send buttons use production components.
export * from '../at2718/dependencies'
import { useSyncExternalStore } from 'react'
import Fake from '../at2718/dependencies'
import { translate as realTranslate, setLanguage } from '../../i18n/TranslationService.js'

setLanguage('de')
export const translate = realTranslate
const assistant = { uid: 'anna-fixture', displayName: 'Anna Alldone', photoURL300: '' }
const project = { id: 'fixture-project', index: 0, name: 'Layout test', assistants: [assistant] }
const state = {
    loggedUser: { uid: 'fixture-user', gold: 1000, defaultProjectId: project.id },
    loggedUserProjects: [project],
    selectedProjectIndex: 0,
    defaultAssistant: assistant,
    globalAssistants: [assistant],
    showFloatPopup: 0,
}
const subscribe = callback => {
    window.addEventListener('resize', callback)
    return () => window.removeEventListener('resize', callback)
}
export const useSelector = selector => {
    const width = useSyncExternalStore(subscribe, () => window.innerWidth)
    return selector({ ...state, smallScreenNavigation: width < 640 })
}
export const useDispatch = () => () => {}
export const getAssistantLineData = () => ({ assistant, assistantProject: project, assistantProjectId: project.id })
export const getOptionsPresentationData = () => ({ optionsLikeButtons: [], optionsInModal: [] })
export const getCollapsedQuickActionCount = () => 0
export const watchAssistantTasks = (_project, _assistant, _key, callback) => callback([])
export const unwatch = () => {}
export const useVoiceCall = () => ({ status: 'idle', startCall: () => {} })
export const updateNewAttachmentsData = async (_project, text) => text
window.__sent = []
export const createBotQuickTopic = async (_assistant, text) => {
    window.__sent.push(text)
    return { id: 'fixture-chat' }
}
export default Object.assign(Fake, { getState: () => state, dispatch: () => {}, subscribe: () => () => {} })
