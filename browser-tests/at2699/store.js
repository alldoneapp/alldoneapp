import { createStore } from 'redux'

export default createStore(
    (
        state = {
            loggedUser: { uid: 'user-1', gold: 100, language: 'en' },
            loggedUserProjects: [{ id: 'conversation-project' }],
            smallScreenNavigation: window.innerWidth < 600,
            blockShortcuts: false,
            showShortcuts: false,
            showFloatPopup: 0,
        }
    ) => state
)
