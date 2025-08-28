import { URL_NOT_MATCH } from '../URLSystemTrigger'
import { DV_TAB_ADMIN_PANEL_ASSISTANTS, DV_TAB_ADMIN_PANEL_USER } from '../../utils/TabNavigationConstants'
import { URL_ADMIN_PANEL_ASSISTANTS, URL_ADMIN_PANEL_USER } from './URLsAdminPanel'
import { processURLAdminPanelTab } from '../../components/AdminPanel/AdminPanelHelper'

class URLsAdminPanelTrigger {
    static getRegexList = () => {
        return {
            [URL_ADMIN_PANEL_USER]: new RegExp('^/admin/user$'),
            [URL_ADMIN_PANEL_ASSISTANTS]: new RegExp('^/admin/assistants$'),
        }
    }

    static match = pathname => {
        const regexList = URLsAdminPanelTrigger.getRegexList()

        for (let key in regexList) {
            const matchObj = pathname.match(regexList[key])

            if (matchObj) {
                return { key: key, matches: matchObj }
            }
        }

        return URL_NOT_MATCH
    }

    static trigger = (navigation, pathname) => {
        const matchedObj = URLsAdminPanelTrigger.match(pathname)

        switch (matchedObj.key) {
            case URL_ADMIN_PANEL_USER:
                return processURLAdminPanelTab(navigation, DV_TAB_ADMIN_PANEL_USER)
            case URL_ADMIN_PANEL_ASSISTANTS:
                return processURLAdminPanelTab(navigation, DV_TAB_ADMIN_PANEL_ASSISTANTS)
        }
    }
}

export default URLsAdminPanelTrigger
