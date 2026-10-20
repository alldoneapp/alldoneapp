import { createStore } from 'redux'
import { getResponsiveLayoutState } from '../../utils/responsiveLayout'
import { getTotalXpNeededToReachLevel } from '../../utils/Levels'

const params = new URLSearchParams(location.search)
const large = params.has('large')
const responsive = () => getResponsiveLayoutState({ width: innerWidth, sidebarExpanded: false })
const store = createStore(
    (
        state = {
            ...responsive(),
            loggedUser: {
                uid: 'fixture',
                themeName: params.has('classic') ? 'default' : 'modern',
                isAnonymous: params.has('anonymous'),
                sidebarExpanded: false,
                premium: { status: params.has('free') ? '' : 'premium' },
                gold: large ? 123456789 : 10660,
                level: 355,
                xp: getTotalXpNeededToReachLevel(355) + 20000,
                skillPoints: 0,
                photoURL: '',
                monthlyXp: 0,
                monthlyTraffic: 0,
                archivedProjectIds: [],
                templateProjectIds: [],
            },
            loggedUserProjects: [{ id: 'p1', estimationType: 'both', monthlyXp: 0, monthlyTraffic: 0 }],
            selectedProjectIndex: -1,
            topBarWidth: innerWidth,
            expandedNavPicker: false,
            sidebarNumbers: {},
            projectChatNotifications: {},
            activeChatData: null,
            followedFeedsAmount: 0,
            allFeedsAmount: 0,
        },
        action
    ) => {
        if (Array.isArray(action)) return state
        if (action.type === 'Toggle nav picker') return { ...state, expandedNavPicker: action.expanded }
        if (action.type === 'Set top bar width') return { ...state, topBarWidth: action.topBarWidth }
        if (action.type === 'fixture-resize') return { ...state, ...responsive() }
        window.__actions?.push(action)
        return state
    }
)
window.addEventListener('resize', () => store.dispatch({ type: 'fixture-resize' }))
export default store
