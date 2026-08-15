/**
 * @jest-environment jsdom
 *
 * AT-2316 — closing the level-up overlay from its primary action must finish
 * the mobile touch sequence before unmounting. Otherwise compatibility events
 * can reach the screen underneath and leave the mobile sidebar interaction
 * state unusable.
 */
import React, { act, useState } from 'react'
import { createRoot } from 'react-dom/client'

jest.mock('react-redux', () => ({
    useDispatch: () => jest.fn(),
    useSelector: selector => selector({ loggedUser: { automaticSkillPointDistributionEnabled: true } }),
}))
jest.mock('../../../../utils/HelperFunctions', () => ({ applyPopoverWidth: () => ({}) }))
jest.mock('../../../../i18n/TranslationService', () => ({ translate: key => key }))
jest.mock('../../../../redux/actions', () => ({ navigateToSettings: () => ({ type: 'navigate' }) }))
jest.mock('../../../../utils/NavigationService', () => ({ navigate: jest.fn() }))
jest.mock('../../../UIControls/Button', () => props => (
    <button data-level-up-action={props.title} onTouchEnd={props.onPress}>
        {props.title}
    </button>
))
jest.mock('../../../FollowUp/CloseButton', () => () => null)
jest.mock('../GoalMilestoneModal/Line', () => () => null)
jest.mock('./Header', () => () => null)
jest.mock('./LevelAndPoints', () => () => null)

const LevelUpModal = require('./LevelUpModal').default

describe('LevelUpModal mobile dismissal (AT-2316)', () => {
    let container
    let root

    beforeEach(() => {
        global.IS_REACT_ACT_ENVIRONMENT = true
        window.ontouchstart = null
        container = document.createElement('div')
        document.body.appendChild(container)
        root = createRoot(container)
    })

    afterEach(() => {
        act(() => root.unmount())
        container.remove()
        delete window.ontouchstart
        delete global.IS_REACT_ACT_ENVIRONMENT
    })

    it('blocks the trailing compatibility click and leaves the sidebar button usable afterwards', async () => {
        const sidebarPress = jest.fn()

        function Harness() {
            const [levelUpVisible, setLevelUpVisible] = useState(true)

            return (
                <>
                    <button data-testid={'open-sidebar'} onClick={sidebarPress}>
                        Open sidebar
                    </button>
                    {levelUpVisible && <LevelUpModal setShowLevelUpModal={setLevelUpVisible} />}
                </>
            )
        }

        act(() => root.render(<Harness />))

        const autoLevelButton = container.querySelector('[data-level-up-action="Auto-level up skills"]')
        const sidebarButton = container.querySelector('[data-testid="open-sidebar"]')

        act(() => autoLevelButton.dispatchEvent(new Event('touchend', { bubbles: true, cancelable: true })))

        // The overlay stays mounted for the rest of this touch gesture.
        expect(container.querySelector('[data-level-up-action="Auto-level up skills"]')).toBeTruthy()

        // Emulate the mouse/click events mobile browsers can synthesize for
        // that same tap. They must not click through to the app underneath.
        act(() => {
            sidebarButton.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }))
            sidebarButton.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }))
            sidebarButton.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
        })
        expect(sidebarPress).not.toHaveBeenCalled()

        await act(async () => {
            await new Promise(resolve => setTimeout(resolve, 10))
        })
        expect(container.querySelector('[data-level-up-action="Auto-level up skills"]')).toBeNull()

        act(() => sidebarButton.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })))
        expect(sidebarPress).toHaveBeenCalledTimes(1)
    })
})
