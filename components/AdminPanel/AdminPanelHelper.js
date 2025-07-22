import { navigateToAdmin, navigateToAllProjectsTasks, setSelectedNavItem } from '../../redux/actions'
import store from '../../redux/store'
import URLsAdminPanel, {
    URL_ADMIN_PANEL_ASSISTANTS,
    URL_ADMIN_PANEL_USER,
} from '../../URLSystem/AdminPanel/URLsAdminPanel'

export const processURLAdminPanelTab = (navigation, tab) => {
    const { loggedUser, administratorUser } = store.getState()
    if (loggedUser.uid === administratorUser.uid) {
        store.dispatch(navigateToAdmin({ selectedNavItem: tab }))
        switch (tab) {
            case URL_ADMIN_PANEL_USER:
                URLsAdminPanel.replace(URL_ADMIN_PANEL_USER)
                break
            case URL_ADMIN_PANEL_ASSISTANTS:
                URLsAdminPanel.replace(URL_ADMIN_PANEL_ASSISTANTS)
                break
        }
        navigation.navigate('AdminPanelView')
    } else {
        navigation.navigate('Root')
        store.dispatch(navigateToAllProjectsTasks())
    }
}
