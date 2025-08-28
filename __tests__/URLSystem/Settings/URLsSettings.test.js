/**
 * @jest-environment jsdom
 */

import store from '../../../redux/store'
import URLsSettings, {
    URL_SETTINGS, URL_SETTINGS_PROJECTS, URL_SETTINGS_PROJECTS_ARCHIVED, URL_SETTINGS_PROJECTS_FOLLOWING, URL_SETTINGS_INVITATIONS
} from '../../../URLSystem/Settings/URLsSettings'

jest.mock('../../../components/MyPlatform', () => {
    return {
        isMobile: false
    }
})

describe('URLsSettings class', () => {
    describe('Function replace', () => {
        it.each([
            [URL_SETTINGS, '/settings'],
            [URL_SETTINGS_PROJECTS, '/settings/projects'],
            [URL_SETTINGS_PROJECTS_ARCHIVED, '/settings/projects/archived'],
            [URL_SETTINGS_PROJECTS_FOLLOWING, '/settings/projects/following'],
            [URL_SETTINGS_INVITATIONS, '/settings/invitations']]
        )
            ('should set the value for lastVisitedScreen for %p', (constant, url) => {
                URLsSettings.replace(constant)
                const storeState = store.getState()
                expect(storeState.lastVisitedScreen).toEqual([url])
            })
    })

    describe('Function push', () => {
        it('should set the value for lastVisitedScreen for URL_SETTINGS_PROJECTS', () => {
            URLsSettings.replace(URL_SETTINGS)
            URLsSettings.push(URL_SETTINGS_PROJECTS)
            const storeState = store.getState()
            expect(storeState.lastVisitedScreen).toEqual(['/settings', '/settings/projects'])
        })
    })
})
