import React from 'react'
import renderer, { act } from 'react-test-renderer'

import store from '../../redux/store'
import Backend from '../../utils/BackendBridge'
import NotesByProject from './NotesByProject'
import { startLoadingData, stopLoadingData } from '../../redux/actions'

/**
 * AT-2382 — the notes list's "Show more" ghosts.
 *
 * The point of these tests is the LIFECYCLE, not the pixels (NotesListSkeleton.test.js
 * covers the shape): ghosts must appear on the press, survive until the expanded watcher
 * actually delivers, and then disappear in the same update that puts the real notes in.
 */

jest.mock('./NotesListSkeleton', () => 'NotesListSkeleton')
jest.mock('./NotesByDate', () => 'NotesByDate')
jest.mock('./NotesSticky', () => 'NotesSticky')
jest.mock('./NotesHeader', () => 'NotesHeader')
jest.mock('./NoteFilters/NoteOwnerFiltersLine', () => 'NoteOwnerFiltersLine')
jest.mock('../TaskListView/Header/ProjectHeader', () => 'ProjectHeader')
jest.mock('../UIComponents/FloatModals/MorePopupsOfMainViews/Notes/NoteMoreButton', () => 'NoteMoreButton')
jest.mock('../UIControls/ShowMoreButton', () => 'ShowMoreButton')
jest.mock('../../i18n/TranslationService', () => ({ translate: key => key }))

jest.mock('../../redux/store', () => ({
    __esModule: true,
    default: { getState: jest.fn(), dispatch: jest.fn(), subscribe: jest.fn(() => jest.fn()) },
}))

jest.mock('../../utils/BackendBridge', () => ({
    __esModule: true,
    default: {
        mapNoteData: (id, data) => ({ id, ...data }),
        watchAllTabNotes: jest.fn(),
        watchAllTabNotesExpanded: jest.fn(),
        watchAllTabStickyNotes: jest.fn(),
        watchAllTabNotesNeedShowMore: jest.fn(),
        watchAllTabNotesInAllProjects: jest.fn(),
        watchAllTabNotesExpandedInAllProjects: jest.fn(),
        watchAllTabNotesNeedShowMoreInAllProjects: jest.fn(),
        watchFollowedTabNotes: jest.fn(),
        watchFollowedTabNotesExpanded: jest.fn(),
        watchFollowedTabStickyNotes: jest.fn(),
        watchFollowedTabNotesNeedShowMore: jest.fn(),
        watchFollowedTabNotesInAllProjects: jest.fn(),
        watchFollowedTabNotesExpandedInAllProjects: jest.fn(),
        watchFollowedTabNotesNeedShowMoreInAllProjects: jest.fn(),
        unwatchNotes2: jest.fn(),
        unwatchStickyNotes: jest.fn(),
        unwatchNotesNeedShowMore: jest.fn(),
    },
}))

jest.mock('../SettingsView/ProjectsSettings/ProjectHelper', () => ({
    __esModule: true,
    default: {},
    checkIfSelectedAllProjects: index => index === -1,
    checkIfSelectedProject: index => index >= 0,
}))

// NotesByProject sits on top of the whole app graph — `NotesHelper` alone reaches
// `utils/backends/firestore` and from there react-native-gesture-handler, which cannot be
// evaluated under jsdom. These stubs keep the suite about the ghost lifecycle.
jest.mock('./NotesHelper', () => ({
    calcNotesAmountByProjectIndex: () => 5,
    sortNotesFn: (a, b) => b.lastEditionDate - a.lastEditionDate,
    isSomeEditOpen: () => false,
}))
jest.mock('../UIComponents/FloatModals/DateFormatPickerModal', () => ({
    getDateFormat: () => 'DD.MM.YYYY',
    getTimeFormat: () => 'HH:mm',
}))
jest.mock('../HashtagFilters/FilterHelpers/FilterNotes', () => ({
    filterNotes: notes => notes,
    filterStickyNotes: notes => notes,
}))
jest.mock('./NoteFilters/noteOwnerFilterHelper', () => ({
    filterNotesByOwner: notes => notes,
    filterStickyNotesByOwner: notes => notes,
    resolveNoteOwner: () => null,
}))
jest.mock('./noteFilterSubscription', () => ({ getNoteFilterStateUpdate: () => null }))
jest.mock('../../redux/actions', () => ({
    setLastAddNewNoteDate: jest.fn(() => ({ type: 'noop' })),
    setNotesAmounts: jest.fn(() => ({ type: 'noop' })),
    startLoadingData: jest.fn(() => ({ type: 'noop' })),
    stopLoadingData: jest.fn(() => ({ type: 'noop' })),
}))
jest.mock('../Feeds/Utils/FeedsConstants', () => ({ ALL_TAB: 0, FEED_PUBLIC_FOR_ALL: 0 }))

const PROJECT = { id: 'project-1', index: 0, color: '#fff' }

const noteChange = id => ({
    type: 'added',
    doc: {
        id,
        data: () => ({
            lastEditionDate: 1786000000000,
            preview: 'preview',
            title: id,
            stickyData: { days: 0 },
            isPublicFor: [0],
            hasStar: '#FFFFFF',
            userId: 'user-1',
        }),
    },
})

const baseState = {
    hashtagFilters: new Map(),
    noteOwnerFilters: [],
    selectedProjectIndex: 0,
    currentUser: { uid: 'user-1' },
    notesAmounts: [5],
    lastAddNewNoteDate: null,
}

const findGhosts = tree => tree.root.findAllByType('NotesListSkeleton')

const render = async () => {
    let tree
    await act(async () => {
        tree = renderer.create(
            <NotesByProject project={PROJECT} filterBy={0} maxNotesToRender={10} setLastEditNoteDate={jest.fn()} />
        )
        await Promise.resolve()
    })

    // The button only renders once the "is there more?" watcher reports a project with more
    // notes than the current window, so drive that callback the way the backend would.
    const reportMoreAvailable = Backend.watchAllTabNotesNeedShowMore.mock.calls[0][2]
    await act(async () => {
        reportMoreAvailable(25)
        await Promise.resolve()
    })

    return tree
}

describe('NotesByProject "Show more" ghosts', () => {
    beforeEach(() => {
        jest.clearAllMocks()
        store.getState.mockReturnValue(baseState)
    })

    it('renders no ghosts before the button is pressed', async () => {
        const tree = await render()
        expect(findGhosts(tree)).toHaveLength(0)
    })

    it('shows ghosts on expand and keeps them until the expanded watcher delivers', async () => {
        const tree = await render()
        const showMore = tree.root.findByType('ShowMoreButton')

        await act(async () => {
            showMore.props.expand()
            await Promise.resolve()
        })

        expect(findGhosts(tree)).toHaveLength(1)
        expect(Backend.watchAllTabNotesExpanded).toHaveBeenCalledTimes(1)

        // The ghost count is capped by resolveGhostRowCount, so a 10-note window asks for
        // GHOST_MAX_ROWS rather than ten screenfuls of grey.
        expect(findGhosts(tree)[0].props.rowCount).toBe(6)

        // The button is inert while its own request is in flight.
        expect(tree.root.findByType('ShowMoreButton').props.loading).toBe(true)
    })

    it('retires the ghosts in the same update that delivers the notes', async () => {
        const tree = await render()

        await act(async () => {
            tree.root.findByType('ShowMoreButton').props.expand()
            await Promise.resolve()
        })
        expect(findGhosts(tree)).toHaveLength(1)

        const updateNotes = Backend.watchAllTabNotesExpanded.mock.calls[0][1]
        await act(async () => {
            updateNotes([noteChange('note-1'), noteChange('note-2')])
            await Promise.resolve()
        })

        expect(findGhosts(tree)).toHaveLength(0)
    })

    it('ignores a second press while the first request is still in flight', async () => {
        const tree = await render()
        const showMore = tree.root.findByType('ShowMoreButton')

        await act(async () => {
            showMore.props.expand()
            await Promise.resolve()
        })
        await act(async () => {
            tree.root.findByType('ShowMoreButton').props.expand()
            await Promise.resolve()
        })

        // A second subscription would tear the first listener down and restart the wait,
        // with the ghosts already up making it look like progress.
        expect(Backend.watchAllTabNotesExpanded).toHaveBeenCalledTimes(1)
    })

    it('balances the selected project loading wait after its first committed snapshot', async () => {
        const onInitialSnapshot = jest.fn()
        let tree
        await act(async () => {
            tree = renderer.create(
                <NotesByProject
                    project={PROJECT}
                    filterBy={0}
                    maxNotesToRender={10}
                    onInitialSnapshot={onInitialSnapshot}
                    setLastEditNoteDate={jest.fn()}
                />
            )
            await Promise.resolve()
        })

        expect(startLoadingData).toHaveBeenCalledTimes(1)
        expect(stopLoadingData).not.toHaveBeenCalled()

        const updateNotes = Backend.watchAllTabNotes.mock.calls[0][2]
        await act(async () => {
            updateNotes([noteChange('note-1')])
            await Promise.resolve()
        })

        expect(stopLoadingData).toHaveBeenCalledTimes(1)
        expect(onInitialSnapshot).toHaveBeenCalledWith('project-1')
        act(() => tree.unmount())
    })

    it('keeps background all-project listeners out of page loading and connection health', async () => {
        store.getState.mockReturnValue({ ...baseState, selectedProjectIndex: -1 })
        const onInitialSnapshot = jest.fn()
        let tree
        await act(async () => {
            tree = renderer.create(
                <NotesByProject
                    project={PROJECT}
                    filterBy={0}
                    maxNotesToRender={3}
                    onInitialSnapshot={onInitialSnapshot}
                    setLastEditNoteDate={jest.fn()}
                    showInitialSkeleton
                    trackInitialLoad={false}
                />
            )
            await Promise.resolve()
        })

        expect(startLoadingData).not.toHaveBeenCalled()
        expect(findGhosts(tree)).toHaveLength(1)
        expect(findGhosts(tree)[0].props.showProjectHeader).toBe(true)
        expect(Backend.watchAllTabNotesInAllProjects).toHaveBeenCalledWith('project-1', 3, expect.any(Function), {
            trackConnectionHealth: false,
        })

        const updateNotes = Backend.watchAllTabNotesInAllProjects.mock.calls[0][2]
        await act(async () => {
            updateNotes([])
            await Promise.resolve()
        })

        expect(stopLoadingData).not.toHaveBeenCalled()
        expect(findGhosts(tree)).toHaveLength(0)
        expect(onInitialSnapshot).toHaveBeenCalledWith('project-1')
        act(() => tree.unmount())
    })
})
