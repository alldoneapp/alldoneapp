import { createStore } from 'redux'

// Only the state the real composer and the real image/video embeds read.
export default createStore(
    (
        state = {
            loggedUser: { uid: 'user-1', gold: 100, language: 'en', premium: { status: 'premium' } },
            loggedUserProjects: [{ id: 'conversation-project' }],
            loggedUserProjectsMap: {},
            quillTextInputProjectIdsByEditorId: {},
            quillEditorProjectId: 'conversation-project',
            virtualQuillLoaded: false,
            smallScreenNavigation: false,
            isMiddleScreen: false,
            blockShortcuts: false,
            showShortcuts: false,
            showFloatPopup: 0,
        }
    ) => state
)
