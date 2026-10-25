import React from 'react'
import renderer, { act } from 'react-test-renderer'

import UndoActionBar from './UndoActionBar'
import { reverseUndoAction } from '../../utils/undo/undoActions'
import { UNDO_BURST_SETTLE_MS } from '../../utils/undo/undoActionGrouping'
import { UNDO_DISPLAY_TIME_MS } from './undoActionBarMotion'

const mockOnSnapshot = jest.fn()

jest.mock('react-redux', () => ({
    useSelector: selector =>
        selector({
            loggedIn: true,
            loggedUser: { uid: 'user-1' },
        }),
}))
jest.mock('firebase/compat/app', () => ({
    __esModule: true,
    default: {
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
    hexColorToRGBa: () => 'rgba(0,0,0,0.8)',
}))
jest.mock('../../i18n/TranslationService', () => ({
    translate: (value, variables = {}) => value.replace('%{count}', variables.count),
}))
jest.mock('../UIComponents/Ghosts/ghostAnimation', () => ({ useReducedMotion: () => true }))

const now = 10000
const buildAction = (id, createdAt, overrides = {}) => ({
    actionId: id,
    actorId: 'user-1',
    source: 'ui',
    createdAt,
    lastChangedAt: createdAt,
    expiresAt: createdAt + 100000,
    label: `Completed ${id}`,
    status: 'applied',
    operations: [
        {
            objectType: 'task',
            projectId: 'project-1',
            objectId: id,
            kind: 'update',
            before: { done: false },
            after: { done: true },
        },
    ],
    ...overrides,
})

const emit = actions =>
    act(() => {
        mockOnSnapshot.mock.calls[mockOnSnapshot.mock.calls.length - 1][0]({
            docs: actions.map(action => ({ data: () => action })),
        })
    })

const message = tree => tree.root.findByProps({ testID: 'undo-action-message' })
const banners = tree => tree.root.findAllByProps({ testID: 'undo-action-bar' }, { deep: false })

describe('UndoActionBar grouped summaries', () => {
    let tree

    beforeEach(() => {
        jest.clearAllMocks()
        jest.useFakeTimers()
        jest.setSystemTime(now)
        act(() => {
            tree = renderer.create(<UndoActionBar />)
        })
    })

    afterEach(() => {
        act(() => tree.unmount())
        jest.useRealTimers()
    })

    it('settles a rapid compatible burst into one accessible summary without intermediate banners', () => {
        const first = buildAction('first', now)
        const second = buildAction('second', now + 200)

        emit([first])
        act(() => jest.advanceTimersByTime(200))
        emit([second, first])
        act(() => jest.advanceTimersByTime(UNDO_BURST_SETTLE_MS - 1))
        expect(banners(tree)).toHaveLength(0)

        act(() => jest.advanceTimersByTime(1))

        expect(message(tree).props.children).toBe('2 actions completed')
        expect(message(tree).props.accessibilityLiveRegion).toBe('polite')
        expect(message(tree).props['aria-atomic']).toBe(true)
        expect(
            tree.root.findAll(
                node => node.props.testID === 'undo-action-message' && node.props.accessibilityLiveRegion === 'polite',
                { deep: false }
            )
        ).toHaveLength(1)
        expect(tree.root.findByProps({ testID: 'undo-action-button' }).props.accessibilityLabel).toBe('Undo all')
    })

    it('does not combine a rapid action from a different project', () => {
        const first = buildAction('first', now)
        const second = buildAction('second', now + 200, {
            operations: [
                {
                    objectType: 'task',
                    projectId: 'project-2',
                    objectId: 'second',
                    kind: 'update',
                    before: { done: false },
                    after: { done: true },
                },
            ],
        })

        emit([second, first])
        act(() => jest.advanceTimersByTime(UNDO_BURST_SETTLE_MS))

        expect(message(tree).props.children).toBe('Completed second')
        expect(tree.root.findByProps({ testID: 'undo-action-button' }).props.accessibilityLabel).toBe('Undo')
    })

    it('starts its display expiry only after the burst settles', () => {
        emit([buildAction('first', now)])

        act(() => jest.advanceTimersByTime(UNDO_BURST_SETTLE_MS))
        act(() => jest.advanceTimersByTime(UNDO_DISPLAY_TIME_MS - 1))
        expect(banners(tree)).toHaveLength(1)

        act(() => jest.advanceTimersByTime(1))
        expect(banners(tree)).toHaveLength(0)
    })

    it('undoes all group members newest first and then offers one Redo all action', async () => {
        const first = buildAction('first', now)
        const second = buildAction('second', now + 200)
        emit([second, first])
        act(() => jest.advanceTimersByTime(UNDO_BURST_SETTLE_MS))

        await act(async () => {
            tree.root.findByProps({ testID: 'undo-action-button' }).props.onPress({ stopPropagation: jest.fn() })
        })

        expect(reverseUndoAction.mock.calls).toEqual([
            ['second', 'undo'],
            ['first', 'undo'],
        ])
        expect(message(tree).props.children).toBe('2 actions undone')
        expect(tree.root.findByProps({ testID: 'undo-action-button' }).props.accessibilityLabel).toBe('Redo all')
    })

    it('restores completed members and keeps one stable error announcement when Undo all fails', async () => {
        const conflict = new Error('This action changed again')
        reverseUndoAction.mockImplementation((id, direction) => {
            if (id === 'first' && direction === 'undo') return Promise.reject(conflict)
            return Promise.resolve()
        })
        const first = buildAction('first', now)
        const second = buildAction('second', now + 200)
        emit([second, first])
        act(() => jest.advanceTimersByTime(UNDO_BURST_SETTLE_MS))

        await act(async () => {
            tree.root.findByProps({ testID: 'undo-action-button' }).props.onPress({ stopPropagation: jest.fn() })
        })

        expect(reverseUndoAction.mock.calls).toEqual([
            ['second', 'undo'],
            ['first', 'undo'],
            ['second', 'redo'],
        ])
        expect(message(tree).props.children).toBe('This action changed again')

        emit([
            { ...second, lastChangedAt: now + 1000 },
            { ...first, lastChangedAt: now + 900 },
        ])
        expect(message(tree).props.children).toBe('This action changed again')
        expect(tree.root.findAllByProps({ accessibilityLiveRegion: 'polite' }, { deep: false })).toHaveLength(1)
    })

    it('keeps Cmd/Ctrl-Z scoped to the latest atomic action', async () => {
        const first = buildAction('first', now)
        const second = buildAction('second', now + 200)
        emit([second, first])
        act(() => jest.advanceTimersByTime(UNDO_BURST_SETTLE_MS))

        await act(async () => {
            window.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true }))
        })

        expect(reverseUndoAction).toHaveBeenCalledTimes(1)
        expect(reverseUndoAction).toHaveBeenCalledWith('second', 'undo')
        expect(message(tree).props.children).toBe('Undone: Completed second')
    })

    it('leaves the undo shortcut to an active text input', () => {
        emit([buildAction('first', now)])
        act(() => jest.advanceTimersByTime(UNDO_BURST_SETTLE_MS))
        const input = document.createElement('input')
        document.body.appendChild(input)

        act(() => input.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true })))

        expect(reverseUndoAction).not.toHaveBeenCalled()
        input.remove()
    })
})
