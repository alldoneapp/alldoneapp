import store from '../../../../redux/store'
import { hideFloatPopup, hideWebSideBar, setSelectedSidebarTab } from '../../../../redux/actions'
import { dismissAllPopups } from '../../../../utils/HelperFunctions'

// AT-3121: a section row under All projects switches the section there, as Notes and Contacts do;
// the view then writes its own URL (ArtifactsView, WikiView).
export function openAllProjectsSection(dispatch, tab, navigateToRoot) {
    dismissAllPopups(true, true, true)
    const actions = [setSelectedSidebarTab(tab), hideFloatPopup()]
    if (store.getState().smallScreenNavigation) actions.push(hideWebSideBar())
    dispatch(actions)
    navigateToRoot?.()
}
