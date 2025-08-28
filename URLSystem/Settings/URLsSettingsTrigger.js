import { URL_NOT_MATCH } from '../URLSystemTrigger'
import {
    URL_CUSTOMIZATIONS,
    URL_SETTINGS_INVITATIONS,
    URL_SETTINGS_PREMIUM,
    URL_SETTINGS_PROJECTS,
    URL_SETTINGS_PROJECTS_ARCHIVED,
    URL_SETTINGS_PROJECTS_GUIDE,
    URL_SETTINGS_SHORTCUTS,
    URL_SETTINGS_STATISTICS,
    URL_SETTINGS_PROFILE,
    URL_SETTINGS_EXPORT,
} from './URLsSettings'
import SettingsHelper from '../../components/SettingsView/SettingsHelper'
import {
    DV_TAB_SETTINGS_INVITATIONS,
    DV_TAB_SETTINGS_PREMIUM,
    DV_TAB_SETTINGS_PROJECTS,
    DV_TAB_SETTINGS_SHORTCUTS,
    DV_TAB_SETTINGS_STATISTICS,
    DV_TAB_SETTINGS_CUSTOMIZATIONS,
    DV_TAB_SETTINGS_PROFILE,
    DV_TAB_SETTINGS_EXPORT,
} from '../../utils/TabNavigationConstants'
import {
    PROJECT_TYPE_ACTIVE,
    PROJECT_TYPE_ARCHIVED,
    PROJECT_TYPE_GUIDE,
} from '../../components/SettingsView/ProjectsSettings/ProjectsSettings'

class URLsSettingsTrigger {
    static getRegexList = () => {
        return {
            [URL_CUSTOMIZATIONS]: new RegExp('^/settings/customizations$'),
            [URL_SETTINGS_PROFILE]: new RegExp('^/settings/profile$'),
            [URL_SETTINGS_PROJECTS]: new RegExp('^/settings/projects$'),
            [URL_SETTINGS_PROJECTS_ARCHIVED]: new RegExp('^/settings/projects/archived$'),
            [URL_SETTINGS_PROJECTS_GUIDE]: new RegExp('^/settings/projects/community$'),
            // [URL_SETTINGS_PROJECTS_FOLLOWING]: new RegExp('^/settings/projects/following$'),
            [URL_SETTINGS_INVITATIONS]: new RegExp('^/settings/invitations$'),
            [URL_SETTINGS_STATISTICS]: new RegExp('^/settings/statistics$'),
            [URL_SETTINGS_SHORTCUTS]: new RegExp('^/settings/shortcuts$'),
            [URL_SETTINGS_PREMIUM]: new RegExp('^/settings/premium$'),
            [URL_SETTINGS_EXPORT]: new RegExp('^/settings/export$'),
        }
    }

    static match = pathname => {
        const regexList = URLsSettingsTrigger.getRegexList()

        for (let key in regexList) {
            const matchObj = pathname.match(regexList[key])

            if (matchObj) {
                return { key: key, matches: matchObj }
            }
        }

        return URL_NOT_MATCH
    }

    static trigger = (navigation, pathname) => {
        const matchedObj = URLsSettingsTrigger.match(pathname)

        switch (matchedObj.key) {
            case URL_CUSTOMIZATIONS:
                return SettingsHelper.processURLSettingsTab(navigation, DV_TAB_SETTINGS_CUSTOMIZATIONS)
            case URL_SETTINGS_PROFILE:
                return SettingsHelper.processURLSettingsTab(navigation, DV_TAB_SETTINGS_PROFILE)
            case URL_SETTINGS_PROJECTS:
                return SettingsHelper.processURLSettingsTab(navigation, DV_TAB_SETTINGS_PROJECTS, PROJECT_TYPE_ACTIVE)
            case URL_SETTINGS_PROJECTS_ARCHIVED:
                return SettingsHelper.processURLSettingsTab(navigation, DV_TAB_SETTINGS_PROJECTS, PROJECT_TYPE_ARCHIVED)
            case URL_SETTINGS_PROJECTS_GUIDE:
                return SettingsHelper.processURLSettingsTab(navigation, DV_TAB_SETTINGS_PROJECTS, PROJECT_TYPE_GUIDE)
            case URL_SETTINGS_INVITATIONS:
                return SettingsHelper.processURLSettingsTab(navigation, DV_TAB_SETTINGS_INVITATIONS)
            case URL_SETTINGS_STATISTICS:
                return SettingsHelper.processURLSettingsTab(navigation, DV_TAB_SETTINGS_STATISTICS)
            case URL_SETTINGS_SHORTCUTS:
                return SettingsHelper.processURLSettingsTab(navigation, DV_TAB_SETTINGS_SHORTCUTS)
            case URL_SETTINGS_PREMIUM:
                return SettingsHelper.processURLSettingsTab(navigation, DV_TAB_SETTINGS_PREMIUM)
            case URL_SETTINGS_EXPORT:
                return SettingsHelper.processURLSettingsTab(navigation, DV_TAB_SETTINGS_EXPORT)
        }
    }
}

export default URLsSettingsTrigger
