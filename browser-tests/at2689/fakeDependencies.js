// Isolate navigation, backend calls and popup contents; keep the real header,
// tags, popover anchor and copy/search/new-window controls in the browser.
export const OPEN_STEP = 'open'
export const RECURRENCE_NEVER = 'never'
export const TASK_ASSIGNEE_ASSISTANT_TYPE = 'assistant'
export const updateShowAllProjectsByTime = () => {}
export const copyTextToClipboard = () => {
    window.__copied = true
}
export const getDvMainTabLink = () => '/task'
export const getRecurrenceInfo = () => ({ short: 'Daily', large: 'Daily' })
export const getTaskAutoEstimation = () => false
export const getEstimationIconByValue = () => 1
export const getEstimationTagText = () => '1 hour'
export const setTaskAutoEstimation = () => {}
export const setTaskEstimations = () => {}
export const setTaskObserverEstimations = () => {}

const dependencies = {
    getProjectById: () => window.__project,
    getProjectIndexById: () => 0,
    accessGranted: () => !window.__shared,
    checkIfLoggedUserIsNormalUserInGuide: () => false,
    getAndAssignUserPrivacy: () => {},
    processUrl: () => {
        window.__projectOpened = true
    },
}
// Popup children are mounted as elements but not opened during layout tests.
const Fake = () => null
Object.assign(Fake, dependencies)
export default Fake
