/**
 * AT-2257 browser regression harness — entry point.
 *
 * "Search Popup: I should be able to press ESC on this popup (and all others) to
 *  close it again."
 *
 * Why a browser test and not a Jest test: the defect is a DOM event-propagation
 * defect. react-native-web's TextInput calls `e.stopPropagation()` on every
 * keydown, React 18 attaches its synthetic listeners at the ROOT CONTAINER, and
 * the app's Escape handlers all live on `document`/`window` in the BUBBLE phase —
 * so Escape never arrives while a field has focus. Reproducing that needs a real
 * key event dispatched by a real browser through a real React root at real focus;
 * in jsdom every layer involved would have to be a double, and the bug lives
 * precisely in how those layers are wired together.
 *
 * This harness therefore renders the REAL `GlobalSearchModal`, mounted the way
 * `GlobalModalsContainerApp` mounts it — gated on the real `showGlobalSearchPopup`
 * redux flag, so "closed" means the component genuinely unmounted — and drives it
 * with `page.keyboard.press('Escape')`. The real `SearchForm` (with its real
 * autofocus and real capture-phase early-keystroke listener), the real
 * `ProjectFilter`, the real nested `SelectProjectModalInSearch` and the real
 * `ModalsManager` registry are all in the tree.
 */
import 'setimmediate'
import React from 'react'
import { createRoot } from 'react-dom/client'
import { Provider, useSelector } from 'react-redux'

import store from '../../redux/store'
import { initFirebase } from '../../utils/backends/firestore'
import { showGlobalSearchPopup, toggleSmallScreenNavigation } from '../../redux/actions'
import { installEscapeStack } from '../../utils/escapeStack'
import GlobalSearchModal from '../../components/GlobalSearchAlgolia/GlobalSearchModal'
import SelectProjectModalInSearch, {
    ALL_PROJECTS_OPTION,
} from '../../components/UIComponents/FloatModals/SelectProjectModal/SelectProjectModalInSearch'
import { GLOBAL_SEARCH_MODAL_ID, isModalOpen } from '../../components/ModalsManager/modalsManager'

// Without this, `watchUserProjects` / `getAllUserProjects` throw inside the
// modal's mount effects and React unwinds the whole tree before it renders.
initFirebase()
// `AppNavigator`'s `AppContainer` does exactly this in the real app.
installEscapeStack()

const PROJECT_ID = 'proj-1'
const UID = 'user-1'

const user = {
    uid: UID,
    displayName: 'Test User',
    email: 't@e.st',
    photoURL: '',
    photoURL300: '',
    defaultProjectId: PROJECT_ID,
    activeProjects: [PROJECT_ID],
    inactiveProjects: [],
    projectIds: [PROJECT_ID],
    isAnonymous: false,
    // GlobalSearchModal reads these straight off loggedUser.
    premium: { status: 'FREE' },
    realGuideProjectIds: [],
    realTemplateProjectIds: [],
    realArchivedProjectIds: [],
    activeFullSearchDate: null,
    workstreams: {},
}

store.dispatch({ type: 'Init anonymous sesion', loggedUser: user, currentUser: user })
store.dispatch({
    type: 'Set project initial data',
    project: { id: PROJECT_ID, name: 'Proj', color: '#ffffff', isShared: false, parentTemplateId: null },
    users: [user],
    workstreams: [],
    contacts: [],
    assistants: [],
})

const params = new URLSearchParams(window.location.search)
store.dispatch(toggleSmallScreenNavigation(params.get('mobile') === '1'))

// The nested layer. In production the search popup's scope row swaps its own body
// for this picker; here it is mounted over the popup on demand, because the row is
// disabled until `getAllUserProjects` returns and this harness has no backend.
// Both components are the real ones and both register on the real escape stack in
// the real order (popup first, picker second), which is the contract under test:
// the innermost layer takes the key and the one underneath survives.
let openPicker = () => {}

function Harness() {
    const open = useSelector(state => state.showGlobalSearchPopup)
    const [pickerOpen, setPickerOpen] = React.useState(false)

    openPicker = () => setPickerOpen(true)
    React.useEffect(() => {
        if (!open) setPickerOpen(false)
    }, [open])

    if (!open) return null

    return (
        <React.Fragment>
            <GlobalSearchModal />
            {pickerOpen ? (
                <div id="nested-picker" style={{ position: 'fixed', inset: 0, zIndex: 20000 }}>
                    <SelectProjectModalInSearch
                        projectId={ALL_PROJECTS_OPTION}
                        closePopover={() => setPickerOpen(false)}
                        projects={[
                            {
                                id: PROJECT_ID,
                                name: 'Proj',
                                color: '#ffffff',
                                isShared: false,
                                // ProjectHelper.sortProjects indexes this by uid.
                                sortIndexByUser: { [UID]: 1 },
                            },
                        ]}
                        setSelectedProjectId={() => {}}
                        showGuideTab={false}
                        showTemplateTab={false}
                        showArchivedTab={true}
                        showAllProjects={true}
                    />
                </div>
            ) : null}
        </React.Fragment>
    )
}

const SEARCH_FIELD = 'input[placeholder="Search term..."]'

window.__openSearch = () => store.dispatch(showGlobalSearchPopup(false))

window.__searchState = () => ({
    redux: !!store.getState().showGlobalSearchPopup,
    registry: isModalOpen(GLOBAL_SEARCH_MODAL_ID),
    searchFieldVisible: !!document.querySelector(SEARCH_FIELD),
    focusedTag: document.activeElement ? document.activeElement.tagName : null,
    focusedIsSearchField:
        !!document.querySelector(SEARCH_FIELD) && document.activeElement === document.querySelector(SEARCH_FIELD),
})

window.__openPicker = () => openPicker()
window.__pickerOpen = () => !!document.getElementById('nested-picker')

createRoot(document.getElementById('root')).render(
    <Provider store={store}>
        <Harness />
    </Provider>
)

window.__ready = true
