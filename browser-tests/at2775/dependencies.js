const params = new URLSearchParams(location.search)
export default {
    watchUserStatistics: (id, type, user, start, end, key, update) =>
        update(id, {
            doneTasks: params.has('large') ? 1234567 : 692,
            donePoints: params.has('points') ? 12345 : 0,
        }),
    unwatch: () => {},
    navigate: (...args) => window.__navigation.push(args),
}
export const checkIfSelectedProject = index => index >= 0
export const ALL_PROJECTS_INDEX = -1
export const ESTIMATION_TYPE_POINTS = 'points'
export const ESTIMATION_TYPE_BOTH = 'both'
export const getEstimationTypeToUse = () => 'both'
export const PLAN_STATUS_PREMIUM = 'premium'
export const getPersonalTrafficQuote = () => 10
export const getPersonalXpQuote = () => 10
export const getProjectTrafficQuote = () => 10
export const getProjectXpQuote = () => 10
export const WORKSTREAM_ID_PREFIX = 'workstream-'
export const setUserShowSkillPointsNotification = () => window.__profileNotifications++
export const getDateFormat = () => 'DD.MM.YYYY'
export const dismissAllPopups = () => {}
export const getFollowedAndUnfollowedChatNotificationsAmount = () => ({ totalFollowed: 15, totalUnfollowed: 0 })
export const resetNotificationsWhenUserHasAnActiveChat = value => value
export const runHttpsCallableFunction = () => {}
export const getWorkflowStepsIdsSorted = () => []
export const getEstimationRealValue = () => 0
