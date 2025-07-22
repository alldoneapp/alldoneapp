import URLSystemTrigger, { URL_NOT_MATCH } from './URLSystemTrigger'
import URLsContactsTrigger from './Contacts/URLsContactsTrigger'
import URLsPeopleTrigger from './People/URLsPeopleTrigger'
import URLsProjectsTrigger from './Projects/URLsProjectsTrigger'
import URLsSettingsTrigger from './Settings/URLsSettingsTrigger'
import URLsAdminPanelTrigger from './AdminPanel/URLsAdminPanelTrigger'
import URLsTasksTrigger from './Tasks/URLsTasksTrigger'
import URLsGoalsTrigger from './Goals/URLsGoalsTrigger'
import URLsSkillsTrigger from './Skills/URLsSkillsTrigger'
import URLsAssistantsTrigger from './Assistants/URLsAssistantsTrigger'

import store from '../redux/store'
import { navigateToAllProjectsTasks } from '../redux/actions'
import URLsTasks, { URL_ALL_PROJECTS_TASKS_OPEN } from './Tasks/URLsTasks'
import URLsNotesTrigger from './Notes/URLsNotesTrigger'
import SharedHelper from '../utils/SharedHelper'
import URLsChatsTrigger from './Chats/URLsChatsTrigger'

export const MIN_URLS_IN_HISTORY = 2

class URLTrigger {
    static getRegexList = () => {
        return [
            URLSystemTrigger,
            URLsTasksTrigger,
            URLsPeopleTrigger,
            URLsProjectsTrigger,
            URLsContactsTrigger,
            URLsSettingsTrigger,
            URLsAdminPanelTrigger,
            URLsNotesTrigger,
            URLsGoalsTrigger,
            URLsChatsTrigger,
            URLsSkillsTrigger,
            URLsAssistantsTrigger,
        ]
    }

    static processUrl = (navigation, pathname) => {
        SharedHelper.processUrlAsLoggedIn(navigation, pathname, false)
    }

    static directProcessUrl = (navigation, pathname) => {
        const matchersList = URLTrigger.getRegexList()
        for (let key in matchersList) {
            const matchResult = matchersList[key].match(pathname)
            if (matchResult !== URL_NOT_MATCH) {
                return matchersList[key].trigger(navigation, pathname)
            }
        }

        // URL_NOT_MATCH
        URLsTasks.replace(URL_ALL_PROJECTS_TASKS_OPEN)

        navigation.navigate('Root')
        store.dispatch(navigateToAllProjectsTasks())
    }
}

export default URLTrigger
