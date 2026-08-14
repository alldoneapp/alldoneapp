/**
 * @jest-environment jsdom
 */

import React from 'react'
import renderer, { act } from 'react-test-renderer'
import { useDispatch, useSelector } from 'react-redux'

const mockCollectNoteOwnerCounts = jest.fn()
const mockResolveNoteOwner = jest.fn()

jest.mock('react-redux', () => ({
    useSelector: jest.fn(),
    useDispatch: jest.fn(),
    shallowEqual: (a, b) => a === b,
}))
jest.mock('../../../i18n/TranslationService', () => ({ translate: text => text }))
jest.mock('./noteOwnerFilterHelper', () => ({
    NOTE_OWNER_UNASSIGNED: '__noteOwnerUnassigned__',
    collectNoteOwnerCounts: (...args) => mockCollectNoteOwnerCounts(...args),
    resolveNoteOwner: (...args) => mockResolveNoteOwner(...args),
}))
jest.mock('../../Avatar', () => {
    const React = require('react')
    return props => React.createElement('Avatar', props)
})
jest.mock('../../Icon', () => {
    const React = require('react')
    return props => React.createElement('Icon', props)
})
jest.mock('../../../redux/actions', () => ({
    setNoteOwnerFilters: ownerIds => ({ type: 'Set note owner filters', ownerIds }),
    clearNoteOwnerFilters: () => ({ type: 'Clear note owner filters' }),
}))

import NoteOwnerFiltersLine from './NoteOwnerFiltersLine'

const HUMAN_ID = 'human-1'
const ASSISTANT_ID = 'assistant-1'

const buildState = overrides => ({
    noteOwnerFilters: [],
    selectedProjectIndex: 0,
    ...overrides,
})

// react-test-renderer matches every node carrying the testID (the composite chip plus the
// host nodes TouchableOpacity renders beneath it), so existence is asserted with hasTestID
// and interactions use the outermost match.
const findByTestID = (component, testID) => component.root.findAll(node => node.props.testID === testID)
const hasTestID = (component, testID) => findByTestID(component, testID).length > 0

describe('NoteOwnerFiltersLine', () => {
    let dispatch

    beforeEach(() => {
        jest.clearAllMocks()
        dispatch = jest.fn()
        useDispatch.mockReturnValue(dispatch)
        mockResolveNoteOwner.mockImplementation((projectId, ownerId) => ({
            uid: ownerId,
            displayName: ownerId === ASSISTANT_ID ? 'Alldone CTO' : 'Karsten',
            photoURL: `${ownerId}.png`,
            isAssistant: ownerId === ASSISTANT_ID,
        }))
    })

    const setState = overrides => {
        const state = buildState(overrides)
        useSelector.mockImplementation(selector => selector(state))
    }

    const render = (props = {}) => {
        let component
        act(() => {
            component = renderer.create(
                <NoteOwnerFiltersLine projectId="project-1" notes={{}} stickyNotes={[]} {...props} />
            )
        })
        return component
    }

    test('renders a chip per owner plus the All chip', () => {
        mockCollectNoteOwnerCounts.mockReturnValue({
            counts: { [HUMAN_ID]: 3, [ASSISTANT_ID]: 2 },
            total: 5,
            ownerIds: [HUMAN_ID, ASSISTANT_ID],
        })
        setState()

        const component = render()

        expect(hasTestID(component, 'note-owner-filters')).toBe(true)
        expect(hasTestID(component, 'note-owner-filter-all')).toBe(true)
        expect(hasTestID(component, `note-owner-filter-${HUMAN_ID}`)).toBe(true)
        expect(hasTestID(component, `note-owner-filter-${ASSISTANT_ID}`)).toBe(true)
    })

    test('renders nothing when every loaded note has the same owner', () => {
        mockCollectNoteOwnerCounts.mockReturnValue({ counts: { [HUMAN_ID]: 4 }, total: 4, ownerIds: [HUMAN_ID] })
        setState()

        expect(findByTestID(render(), 'note-owner-filters')).toHaveLength(0)
    })

    test('renders nothing when there are no notes at all', () => {
        mockCollectNoteOwnerCounts.mockReturnValue({ counts: {}, total: 0, ownerIds: [] })
        setState()

        expect(findByTestID(render(), 'note-owner-filters')).toHaveLength(0)
    })

    test('selecting an owner dispatches that owner as the filter', () => {
        mockCollectNoteOwnerCounts.mockReturnValue({
            counts: { [HUMAN_ID]: 3, [ASSISTANT_ID]: 2 },
            total: 5,
            ownerIds: [HUMAN_ID, ASSISTANT_ID],
        })
        setState()

        const component = render()
        act(() => {
            findByTestID(component, `note-owner-filter-${ASSISTANT_ID}`)[0].props.onPress()
        })

        expect(dispatch).toHaveBeenCalledWith({ type: 'Set note owner filters', ownerIds: [ASSISTANT_ID] })
    })

    test('deselecting the last owner clears the filter rather than setting an empty list', () => {
        mockCollectNoteOwnerCounts.mockReturnValue({
            counts: { [HUMAN_ID]: 3, [ASSISTANT_ID]: 2 },
            total: 5,
            ownerIds: [HUMAN_ID, ASSISTANT_ID],
        })
        setState({ noteOwnerFilters: [ASSISTANT_ID] })

        const component = render()
        act(() => {
            findByTestID(component, `note-owner-filter-${ASSISTANT_ID}`)[0].props.onPress()
        })

        expect(dispatch).toHaveBeenCalledWith({ type: 'Clear note owner filters' })
    })

    test('owners accumulate when several chips are selected', () => {
        mockCollectNoteOwnerCounts.mockReturnValue({
            counts: { [HUMAN_ID]: 3, [ASSISTANT_ID]: 2 },
            total: 5,
            ownerIds: [HUMAN_ID, ASSISTANT_ID],
        })
        setState({ noteOwnerFilters: [HUMAN_ID] })

        const component = render()
        act(() => {
            findByTestID(component, `note-owner-filter-${ASSISTANT_ID}`)[0].props.onPress()
        })

        expect(dispatch).toHaveBeenCalledWith({
            type: 'Set note owner filters',
            ownerIds: [HUMAN_ID, ASSISTANT_ID],
        })
    })

    test('the All chip clears every filter', () => {
        mockCollectNoteOwnerCounts.mockReturnValue({
            counts: { [HUMAN_ID]: 3, [ASSISTANT_ID]: 2 },
            total: 5,
            ownerIds: [HUMAN_ID, ASSISTANT_ID],
        })
        setState({ noteOwnerFilters: [ASSISTANT_ID] })

        const component = render()
        act(() => {
            findByTestID(component, 'note-owner-filter-all')[0].props.onPress()
        })

        expect(dispatch).toHaveBeenCalledWith({ type: 'Clear note owner filters' })
    })

    // AT-2264: the header used to carry a badge with the number of selected filters. It read
    // like an item count next to the per-chip counts, so it is gone -- the highlighted chips
    // already say what is selected. The per-chip counts stay: those are item counts.
    test('does not show how many filters are selected', () => {
        mockCollectNoteOwnerCounts.mockReturnValue({
            counts: { [HUMAN_ID]: 3, [ASSISTANT_ID]: 2 },
            total: 5,
            ownerIds: [HUMAN_ID, ASSISTANT_ID],
        })
        setState({ noteOwnerFilters: [HUMAN_ID, ASSISTANT_ID] })

        const component = render()
        expect(hasTestID(component, 'note-owner-filter-active-count')).toBe(false)
        expect(hasTestID(component, `note-owner-filter-${HUMAN_ID}`)).toBe(true)
    })

    test('keeps a selected owner visible after their notes leave the loaded window', () => {
        // Only the human still has loaded notes, but the assistant stays filtered on --
        // without the merge the chip would vanish and the filter could not be switched off.
        mockCollectNoteOwnerCounts.mockReturnValue({ counts: { [HUMAN_ID]: 3 }, total: 3, ownerIds: [HUMAN_ID] })
        setState({ noteOwnerFilters: [ASSISTANT_ID] })

        const component = render()

        expect(hasTestID(component, `note-owner-filter-${ASSISTANT_ID}`)).toBe(true)
    })

    test('stays visible while a filter is active even if only one owner remains loaded', () => {
        // Selecting an owner reloads the list with a wider window, so counts are briefly
        // empty. Hiding the row then would leave no way to press All and clear the filter.
        mockCollectNoteOwnerCounts.mockReturnValue({ counts: {}, total: 0, ownerIds: [] })
        setState({ noteOwnerFilters: [ASSISTANT_ID] })

        const component = render()

        expect(hasTestID(component, 'note-owner-filters')).toBe(true)
        expect(hasTestID(component, 'note-owner-filter-all')).toBe(true)
    })

    test('labels legacy ownerless notes instead of rendering a blank chip', () => {
        mockCollectNoteOwnerCounts.mockReturnValue({
            counts: { [HUMAN_ID]: 2, __noteOwnerUnassigned__: 1 },
            total: 3,
            ownerIds: [HUMAN_ID, '__noteOwnerUnassigned__'],
        })
        setState()

        const component = render()
        const chip = findByTestID(component, 'note-owner-filter-__noteOwnerUnassigned__')[0]

        expect(chip).toBeDefined()
        // No avatar is rendered for the sentinel, so it cannot resolve to a stray image.
        expect(chip.findAllByType('Avatar')).toHaveLength(0)
    })

    test('clears the filter when the project changes and again on unmount', () => {
        mockCollectNoteOwnerCounts.mockReturnValue({
            counts: { [HUMAN_ID]: 3, [ASSISTANT_ID]: 2 },
            total: 5,
            ownerIds: [HUMAN_ID, ASSISTANT_ID],
        })
        setState()

        const component = render()
        expect(dispatch).toHaveBeenCalledWith({ type: 'Clear note owner filters' })

        dispatch.mockClear()
        act(() => {
            component.unmount()
        })
        expect(dispatch).toHaveBeenCalledWith({ type: 'Clear note owner filters' })
    })
})
