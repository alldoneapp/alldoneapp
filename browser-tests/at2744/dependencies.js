import { PROJECT_COLOR_DEFAULT } from '../../Themes/Modern/ProjectColors'

// Read-only account/navigation fixtures. Goal layout, badges, gestures and popup
// shells are real; no Firebase account or production writes are involved.
const fixture = {
    getProjectColorById: () => PROJECT_COLOR_DEFAULT,
    getProjectById: () => ({ goalMilestonesConfig: { mode: 'linear' } }),
    checkIfLoggedUserIsNormalUserInGuide: () => false,
    getTypeOfProject: () => 'active',
    getProjectIndexById: () => 0,
    setUserLastVisitedBoardDate: () => {},
    watchBacklinksCount: () => {},
    watchOpenMilestonesInDateRange: () => {},
    unwatch: () => {},
    unwatchBacklinksCount: () => {},
    navigate: (...args) => window.__navigation.push(args),
    processUrl: (_navigation, path) => window.__navigation.push(path),
}
export default fixture
export const watchGoalLinkedOpenTasksAmount = (_project, _goal, update) => update(130)
export const objectIsLockedForUser = () => false
export const BACKLOG_DATE_NUMERIC = Number.MAX_SAFE_INTEGER
export const DYNAMIC_PERCENT = 'DYNAMIC_PERCENT'
export const CAPACITY_NONE = 'CAPACITY_NONE'
export const capacityDataMap = { [CAPACITY_NONE]: { capacityValue: 0 } }
export const progressMap = {
    90: { progressBorderColor: '#A16AFF', progressTextColor: '#713AFF' },
    [DYNAMIC_PERCENT]: { progressBorderColor: '#A16AFF', progressTextColor: '#713AFF' },
}
export const getHandlerData = id => ({
    handler: { uid: id, photoURL: '' },
    isUser: true,
    isPublicForLoggedUser: true,
})
export const WORKSTREAM_ID_PREFIX = 'workstream-'
export const PROJECT_TYPE_ACTIVE = 'active'
export const setGoalFocusArea = () => {
    throw new Error('Unexpected write in layout harness')
}
export const setWorkstreamLastVisitedBoardDate = () => {}
export const LINKED_OBJECT_TYPE_GOAL = 'goal'
export const getDvTabLink = (project, goal, type, tab) => `/projects/${project}/${type}/${goal}/${tab}`
export const getDateFormat = () => 'DD.MM.YYYY'
export const translate = key => ({ Dynamic: 'Dynamisch', Fixed: 'Fest', 'Focus area': 'Fokusbereich' })[key] || key
export const checkIsLimitedByXp = () => false
export const storeModal = () => {}
export const removeModal = () => {}
export const MENTION_MODAL_ID = 'mention'
export const GOAL_PROGRESS_MODAL_ID = 'progress'
export const setGoalDescription = () => {
    throw new Error('Unexpected write in layout harness')
}
