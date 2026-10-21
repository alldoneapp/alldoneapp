// Synthetic account and transport. The dialogs, overlay host and styles are real.
import { createStore } from 'redux'
import { reduxBatch } from '@manaflair/redux-batch'
import { getSafeAreaModalMaxWidth } from '../../utils/modalSafeArea'

const initialState = {
    loggedUser: {
        uid: 'browser-user',
        projectIds: [],
        templateProjectIds: [],
        archivedProjectIds: [],
        guideProjectIds: [],
        statisticsModalDate: Date.now() - 86400000,
    },
    loggedUserProjects: [],
    limitQuotaModalData: {},
    recordVideoModalData: {},
    screenRecordingModalData: {},
    taskSuggestedCommentModalData: {},
    endCopyProjectPopupData: {},
    showNewDayNotification: false,
    showNewVersionMandtoryNotifcation: false,
    connectionState: 'online',
    connectionHealth: 'live',
    alldoneNewVersion: { major: 2, minor: 0 },
    showConfirmPopupData: { visible: false, object: {} },
}
export const store = createStore((state = initialState, action) => {
    if (action.type === 'fixture') return { ...state, ...action.patch }
    if (action.type === 'Store logged user') return { ...state, loggedUser: action.loggedUser }
    return state
}, reduxBatch)
const noop = () => {}
export const deleteCacheAndRefresh = () => {
    window.reloadClicks = (window.reloadClicks || 0) + 1
}
export const translate = text => text
export const getDateFormat = () => 'DD.MM.YYYY'
export const getIfLoggedUserReachedEmptyInbox = () => false
export const applyPopoverWidth = () => ({ width: Math.min(480, getSafeAreaModalMaxWidth(window.innerWidth)) })
export const setUserStatisticsModalDate = () => Promise.resolve()
export const readNewDayAcknowledgement = () => Promise.resolve(null)
export const reportNewDayStatisticsError = () => Promise.resolve()
export const subscribePageVisible = () => noop
export const normalizeDayRateTimeLogConfig = () => ({ enabled: false })
export const reconcileProjectDayRateTimeLogsBackfill = () => Promise.resolve()
export const getEstimationTypeByProjectId = () => 'points'
export const ESTIMATION_TYPE_POINTS = 'points'
export const ESTIMATION_TYPE_TIME = 'time'
export const getEndDayMoneyEarnedSummary = () => null
export const getHappinessProjects = () => []
export const CONNECTION_HEALTH_LIVE = 'live'
export const CONNECTION_HEALTH_OFFLINE = 'offline'
export const CONNECTION_HEALTH_RECONNECTING = 'reconnecting'
export const CONNECTION_HEALTH_STALE = 'stale'
export const isManualOfflineMode = () => false
export const reconnectNow = () => Promise.resolve()
export const subscribeConnectionHealth = () => noop
export const hideConfirmPopup = () => ({
    type: 'fixture',
    patch: { showConfirmPopupData: { visible: false, object: {} } },
})
export const hideFloatPopup = () => ({ type: 'noop' })
export const storeLoggedUser = loggedUser => ({ type: 'Store logged user', loggedUser })
export const setShowNewDayNotification = () => ({ type: 'noop' })
export const showNewVersionMandtoryNotifcation = () => ({
    type: 'fixture',
    patch: { showNewVersionMandtoryNotifcation: true },
})
export const setShowOptionalVersionNotification = value => ({
    type: 'fixture',
    patch: { showOptionalVersionNotification: value },
})
export default {
    ...store,
    getUserStatistics: noop,
    setProjectHappiness: () => Promise.resolve(),
    watchProjectHappinessByRange: noop,
    unwatch: noop,
    setCachedUserData: noop,
}
