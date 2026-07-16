import React from 'react'
import renderer, { act } from 'react-test-renderer'

import UndoActionBar from './UndoActionBar'
import { reverseUndoAction } from '../../utils/undo/undoActions'

const mockOnSnapshot = jest.fn()

jest.mock('react-redux', () => ({
    useSelector: selector =>
        selector({
            loggedIn: true,
            loggedUser: { uid: 'user-1' },
        }),
}))
jest.mock('@firebase/app', () => ({
    firebase: {
        firestore: () => ({
            collection: () => ({
                orderBy: () => ({
                    limit: () => ({ onSnapshot: mockOnSnapshot }),
                }),
            }),
        }),
    },
}))
jest.mock('../../utils/undo/undoActions', () => ({ reverseUndoAction: jest.fn(() => Promise.resolve()) }))
jest.mock('../styles/global', () => ({
    __esModule: true,
    default: { body2: {}, button: {} },
    colors: { Text01: '#000000', UtilityBlue200: '#0000FF' },
}))
jest.mock('../../i18n/TranslationService', () => ({ translate: value => value }))

const action = {
    actionId: 'action-1',
    createdAt: Date.now(),
    lastChangedAt: Date.now(),
    label: 'Moved task',
    status: 'applied',
}

const renderActionBar = () => {
    let tree
    act(() => {
        tree = renderer.create(<UndoActionBar />)
    })
    act(() => {
        mockOnSnapshot.mock.calls[0][0]({ docs: [{ data: () => action }] })
    })
    return tree
}

describe('UndoActionBar interactions', () => {
    beforeEach(() => {
        jest.clearAllMocks()
    })

    it('dismisses when the notification background is pressed without undoing', () => {
        const tree = renderActionBar()

        act(() => tree.root.findByProps({ testID: 'undo-action-bar' }).props.onPress())

        expect(reverseUndoAction).not.toHaveBeenCalled()
        expect(tree.root.findAllByProps({ testID: 'undo-action-bar' })).toHaveLength(0)
    })

    it('performs undo and stops the action press from bubbling to the notification', async () => {
        const tree = renderActionBar()
        const event = { stopPropagation: jest.fn() }

        await act(async () => {
            tree.root.findByProps({ testID: 'undo-action-button' }).props.onPress(event)
        })

        expect(event.stopPropagation).toHaveBeenCalledTimes(1)
        expect(reverseUndoAction).toHaveBeenCalledWith('action-1', 'undo')
        expect(tree.root.findByProps({ testID: 'undo-action-bar' })).toBeTruthy()
    })
})
