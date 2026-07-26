/**
 * @jest-environment jsdom
 */

import SettingsHelper from '../../components/SettingsView/SettingsHelper'
import URLsSettings, {
    URL_CUSTOMIZATIONS,
    URL_SETTINGS_INVITATIONS,
    URL_SETTINGS_PROFILE,
    URL_SETTINGS_PROJECTS,
} from '../../URLSystem/Settings/URLsSettings'

jest.mock('firebase', () => ({ firestore: {} }))

describe('SettingsHelper class', () => {
    let navigation = {}

    beforeEach(() => {
        navigation = {
            navigate: jest.fn(),
        }
    })

    // Only the tabs the switch in processURLSettingsTab handles reach
    // URLsSettings.replace; the archived projects view is reached through the
    // projects tab with a type rather than a URL constant of its own.
    it.each([
        [URL_CUSTOMIZATIONS, 'SETTINGS_CUSTOMIZATIONS'],
        [URL_SETTINGS_PROFILE, 'SETTINGS_PROFILE'],
        [URL_SETTINGS_INVITATIONS, 'SETTINGS_INVITATIONS'],
        [URL_SETTINGS_PROJECTS, 'SETTINGS_PROJECTS'],
    ])('should execute processURLSettingsTab for %p correctly', (url, param) => {
        URLsSettings.replace = jest.fn()

        SettingsHelper.processURLSettingsTab(navigation, url)
        expect(navigation.navigate).toBeCalledTimes(1)
        expect(navigation.navigate).toBeCalledWith('SettingsView')
        expect(URLsSettings.replace).toBeCalledWith(param)
    })

    it('should execute processURLFeeds correctly', () => {
        SettingsHelper.processURLFeeds(navigation)
        expect(navigation.navigate).toBeCalledTimes(1)
        expect(navigation.navigate).toBeCalledWith('Root')
    })
})
