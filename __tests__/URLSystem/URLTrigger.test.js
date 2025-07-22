/**
 * @jest-environment jsdom
 */

import store from '../../redux/store'
import NavigationService from '../../utils/NavigationService'
import URLTrigger from '../../URLSystem/URLTrigger'
import { DV_TAB_ROOT_TASKS } from '../../utils/TabNavigationConstants'

describe('URLTrigger class', () => {
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
