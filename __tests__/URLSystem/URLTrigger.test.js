/**
 * @jest-environment jsdom
 */

import store from '../../redux/store'
import NavigationService from '../../utils/NavigationService'
import URLTrigger from '../../URLSystem/URLTrigger'
import { DV_TAB_ROOT_TASKS } from '../../utils/TabNavigationConstants'
import SharedHelper from '../../utils/SharedHelper'

describe('URLTrigger class', () => {
    it('recognizes task and note deep links carrying the assistant layout parameter', () => {
        expect(SharedHelper.matchesSharedResourceUrl('/projects/p1/tasks/t1/chat?assistant=1')).toBe(true)
        expect(SharedHelper.matchesSharedResourceUrl('/projects/p1/notes/n1/editor?assistant=1')).toBe(true)
        expect(
            SharedHelper.normalizeInternalUrl(`${window.location.origin}/projects/p1/notes/n1/editor?assistant=1`)
        ).toBe('/projects/p1/notes/n1/editor')
        expect(
            SharedHelper.normalizeInternalUrl('/projects/p1/notes/n1/editor?assistant=1&autoStartTranscription=true')
        ).toBe('/projects/p1/notes/n1/editor?autoStartTranscription=true')
    })

    describe('Function processUrl', () => {
        it('should not match undefined route', () => {
            NavigationService.setTopLevelNavigator({ dispatch: () => {} })

            URLTrigger.processUrl(NavigationService, '/anything')
            const storeState = store.getState()
            expect(storeState.lastVisitedScreen).toEqual(['/projects/tasks/open'])
            expect(storeState.selectedNavItem).toEqual(DV_TAB_ROOT_TASKS)
        })
    })
})
