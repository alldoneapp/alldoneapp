/**
 * @jest-environment jsdom
 */

import store from '../../redux/store'
import URLSystem, { URL_FEEDS, URL_LOGOUT } from '../../URLSystem/URLSystem'

jest.mock('../../components/MyPlatform', () => {
    return {
        isMobile: false
    }
})

describe('URLSystem class', () => {
    describe('Function replace', () => {
        it.each([
            [URL_LOGOUT, '/logout']
        ])
            ('should set the value for lastVisitedScreen for %p', (constant, url) => {
                URLSystem.replace(constant)
                const storeState = store.getState()
                expect(storeState.lastVisitedScreen).toEqual([url])
            })
    })

    describe('Function push', () => {
        it('should set the value for lastVisitedScreen for URL_LOGOUT', () => {
            URLSystem.replace(URL_FEEDS)
            URLSystem.push(URL_LOGOUT)

            const storeState = store.getState()
            expect(storeState.lastVisitedScreen).toEqual(['/undefined', '/logout'])
        })
    })
})