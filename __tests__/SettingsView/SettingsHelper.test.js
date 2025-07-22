/**
 * @jest-environment jsdom
 */

import SettingsHelper from '../../components/SettingsView/SettingsHelper'
import URLsSettings, {
    URL_SETTINGS,
    URL_SETTINGS_INVITATIONS,
    URL_SETTINGS_PROJECTS,
    URL_SETTINGS_PROJECTS_ARCHIVED,
} from '../../URLSystem/Settings/URLsSettings'

jest.mock('firebase', () => ({ firestore: {} }));

describe('SettingsHelper class', () => {
    let navigation = {}

    beforeEach(() => {
        navigation = {
            navigate: jest.fn()
        }
    })

    it.each([
        [URL_SETTINGS, 'SETTINGS'], 
        [URL_SETTINGS_INVITATIONS, 'SETTINGS_INVITATIONS'],
        [URL_SETTINGS_PROJECTS, 'SETTINGS_PROJECTS'],
        [URL_SETTINGS_PROJECTS_ARCHIVED, 'SETTINGS_PROJECTS_ARCHIVED']])
        ('should execute processURLSettingsTab for %p correctly', (url, param) => {
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

    it('should execute processURLProjectFeeds correctly', () => {
        SettingsHelper.processURLProjectFeeds(navigation, 0)
        expect(navigation.navigate).toBeCalledTimes(1)
        expect(navigation.navigate).toBeCalledWith('Root')
    })
})

