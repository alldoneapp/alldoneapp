/**
 * @jest-environment jsdom
 *
 * AT-3025: while the composer is empty its mic sits in this button's place.
 */
import React from 'react'
import renderer, { act } from 'react-test-renderer'

import SubmitButton from './SubmitButton'

jest.mock('react-redux', () => ({ useSelector: selector => selector({ smallScreenNavigation: false }) }))
jest.mock('../../ModalShell/AppPopover', () => {
    const React = require('react')
    return ({ children }) => <>{children}</>
})
jest.mock('../../../UIControls/Button', () => 'Button')
jest.mock(
    '../../../ChatsView/ChatDV/EditorView/BotOption/RunOutOfGoldAssistantModal',
    () => 'RunOutOfGoldAssistantModal'
)
jest.mock('../../../../utils/setDomAttributes', () => ({ setDomAttributes: jest.fn() }))

const render = props => {
    let tree
    act(() => {
        tree = renderer.create(
            <SubmitButton
                onSubmit={jest.fn()}
                setShowRunOutGoalModal={jest.fn()}
                showRunOutGoalModal={false}
                {...props}
            />
        )
    })
    return tree
}

describe('comment popup submit slot (AT-3025)', () => {
    it('renders the button as before when the host has no mic slot', () => {
        const tree = render({ disabled: true })
        expect(tree.root.findAllByType('Button')).toHaveLength(1)
    })

    it('hands the host a node for the mic, ahead of the button', () => {
        const setDictationSlot = jest.fn()
        render({ setDictationSlot })
        expect(setDictationSlot).toHaveBeenCalled()
    })

    it('steps aside while the mic is in its slot', () => {
        const tree = render({ setDictationSlot: jest.fn(), micInSendSlot: true })
        expect(tree.root.findAllByType('Button')).toHaveLength(0)
        act(() =>
            tree.update(
                <SubmitButton
                    onSubmit={jest.fn()}
                    setShowRunOutGoalModal={jest.fn()}
                    setDictationSlot={jest.fn()}
                    micInSendSlot={false}
                />
            )
        )
        expect(tree.root.findAllByType('Button')).toHaveLength(1)
    })
})
