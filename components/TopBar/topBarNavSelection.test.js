import React from 'react'
import renderer, { act } from 'react-test-renderer'
import { useSelector } from 'react-redux'
import { AnnaAppShownContext } from '../Anna/AnnaTopStripContext'
import { isChatsViewActive, useTopBarViewSelected } from './topBarNavSelection'
import { DV_TAB_ROOT_CHATS } from '../../utils/TabNavigationConstants'

jest.mock('react-redux', () => ({ useSelector: jest.fn() }))

const selectedWith = (route, appShown) => {
    useSelector.mockImplementation(selector => selector({ route }))
    let selected
    const Probe = () => {
        selected = useTopBarViewSelected(isChatsViewActive)
        return null
    }
    act(() => {
        renderer.create(
            appShown === undefined ? (
                <Probe />
            ) : (
                <AnnaAppShownContext.Provider value={appShown}>
                    <Probe />
                </AnnaAppShownContext.Provider>
            )
        )
    })
    return selected
}

// The Chats and Updates buttons mark their view only while Alldone is on screen: back in the
// assistant, the view still mounted behind the chat is not where the user is.
describe('useTopBarViewSelected', () => {
    it('marks the view while it is on screen, also outside AnnaShell', () => {
        expect(selectedWith(DV_TAB_ROOT_CHATS)).toBe(true)
        expect(selectedWith(DV_TAB_ROOT_CHATS, true)).toBe(true)
        expect(selectedWith('ROOT_TASKS', true)).toBe(false)
    })

    it('does not mark it while the assistant is in front', () => {
        expect(selectedWith(DV_TAB_ROOT_CHATS, false)).toBe(false)
    })
})
