// Local routing fixture: no Firebase connections or account data.
let state = { lastVisitedScreen: [] }
const dependencies = {
    getProjectNameById: () => 'Product',
    getUserNameById: () => 'Karsten',
    getContactNameById: () => 'Karl',
    getFirstName: value => value,
    getState: () => state,
    dispatch: action => {
        state = { ...state, lastVisitedScreen: action.screens }
    },
}
export default dependencies
export const setLastVisitedScreen = screens => ({ screens })
export const DEFAULT_WORKSTREAM_ID = 'ws@default'
export const WORKSTREAM_ID_PREFIX = 'ws@'
export const getWorkstreamById = () => null
export const getAssistant = () => null
export const GLOBAL_PROJECT_ID = 'global'
export const getProjectData = async () => ({ name: 'Product' })
