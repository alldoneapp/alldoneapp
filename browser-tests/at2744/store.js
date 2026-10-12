import { createStore } from 'redux'
import { reduxBatch } from '@manaflair/redux-batch'
import { getResponsiveLayoutState } from '../../utils/responsiveLayout'

const user = { uid: 'u1', isAnonymous: false, unlockedKeysByGuides: [], sidebarExpanded: true }
export default createStore(
    (
        state = {
            loggedUser: user,
            currentUser: user,
            loggedUserProjectsMap: {
                p1: {
                    focusAreas: { long: { name: 'Strategische Produktentwicklung und internationale Expansion' } },
                },
            },
            openModals: {},
            showFloatPopup: 0,
            ...getResponsiveLayoutState({ width: window.innerWidth, sidebarExpanded: true }),
        },
        action
    ) => {
        window.__actions?.push(action)
        if (action.type === 'viewport') return { ...state, ...action.layout }
        if (action.type === 'Show float popup') return { ...state, showFloatPopup: state.showFloatPopup + 1 }
        if (action.type === 'Hide float popup') return { ...state, showFloatPopup: state.showFloatPopup - 1 }
        return state
    },
    reduxBatch
)
