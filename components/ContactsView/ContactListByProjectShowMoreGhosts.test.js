import React from 'react'
import renderer, { act } from 'react-test-renderer'

import ContactListByProject from './ContactListByProject'

/**
 * AT-2385 — the Contacts list "Show more" / chevron-down.
 *
 * The point of these tests is the LIFECYCLE (ContactsListSkeleton.test.js covers the
 * pixels): before this change one press mounted EVERY remaining contact synchronously,
 * with no ghost and no way to bound the cost. Now a press reveals one page, ghosts the
 * page while it mounts, and disarms the button until the rows are in.
 */

jest.mock('./ContactsListSkeleton', () => 'ContactsListSkeleton')
jest.mock('./ContactItem', () => 'ContactItem')
jest.mock('./EditContact', () => 'EditContact')
jest.mock('./NewContactSection', () => 'NewContactSection')
jest.mock('./ContactsHeader', () => 'ContactsHeader')
jest.mock('../ContactStatusFilters/ContactStatusFiltersView', () => 'ContactStatusFiltersView')
jest.mock('../TaskListView/Header/ProjectHeader', () => 'ProjectHeader')
jest.mock('../UIComponents/FloatModals/MorePopupsOfMainViews/Contacts/ContactMoreButton', () => 'ContactMoreButton')
jest.mock('../UIComponents/DismissibleItem', () => 'DismissibleItem')
jest.mock('../UIControls/ShowMoreButton', () => 'ShowMoreButton')
jest.mock('../../i18n/TranslationService', () => ({ translate: key => key }))

const storeState = { blockShortcuts: false }

jest.mock('../../redux/store', () => ({
    __esModule: true,
    default: { getState: () => storeState, dispatch: jest.fn(), subscribe: jest.fn(() => jest.fn()) },
}))

jest.mock('../SettingsView/ProjectsSettings/ProjectHelper', () => ({
    __esModule: true,
    default: {},
    checkIfSelectedProject: () => true,
}))

jest.mock('./Utils/ContactsHelper', () => ({
    __esModule: true,
    default: { sortContactsFn: () => 0 },
    isSomeContactEditOpen: () => false,
}))

jest.mock('../../utils/HelperFunctions', () => ({
    dismissAllPopups: jest.fn(),
    isInputsFocused: () => false,
}))

jest.mock('../HashtagFilters/UseSelectorHashtagFilters', () => ({
    __esModule: true,
    default: () => [new Map(), []],
}))

jest.mock('../ContactStatusFilters/useSelectorContactStatusFilter', () => ({
    __esModule: true,
    default: () => [null],
}))

jest.mock('../HashtagFilters/FilterHelpers/FilterContacts', () => ({
    filterContacts: list => list,
}))

jest.mock('../../redux/actions', () => ({
    setLastAddNewContact: jest.fn(() => ({ type: 'noop' })),
}))

const project = { id: 'project-1', index: 0 }

jest.mock('react-redux', () => ({
    useDispatch: () => jest.fn(),
    useSelector: selector =>
        selector({
            selectedProjectIndex: 0,
            loggedUser: { uid: 'user-1' },
            projectContacts: {},
            lastAddNewContact: null,
            loggedUserProjects: [{ id: 'project-1', index: 0 }],
        }),
}))

const makeContacts = amount =>
    Array.from({ length: amount }, (_, index) => ({
        uid: `contact-${index}`,
        displayName: `Contact ${index}`,
        recorderUserId: 'user-1',
    }))

const render = contactsAmount => {
    let tree
    act(() => {
        tree = renderer.create(
            <ContactListByProject
                projectIndex={0}
                members={[]}
                contacts={makeContacts(contactsAmount)}
                onlyMembers={false}
                maxContactsToRender={10}
            />
        )
    })
    return tree
}

const rows = tree => tree.root.findAllByType('DismissibleItem').length
const ghosts = tree => tree.root.findAllByType('ContactsListSkeleton')
const showMore = tree => tree.root.findByType('ShowMoreButton')

// The component reveals a page on the second animation frame; drive both by hand so the
// mid-flight state is observable.
const flushFrames = frames =>
    act(() => {
        const queued = frames.splice(0, frames.length)
        queued.forEach(callback => callback())
    })

describe('ContactListByProject "Show more" ghosts (AT-2385)', () => {
    let frames
    let originalRaf
    let originalCancelRaf

    beforeEach(() => {
        frames = []
        originalRaf = global.requestAnimationFrame
        originalCancelRaf = global.cancelAnimationFrame
        global.requestAnimationFrame = callback => frames.push(callback)
        global.cancelAnimationFrame = jest.fn()
    })

    afterEach(() => {
        global.requestAnimationFrame = originalRaf
        global.cancelAnimationFrame = originalCancelRaf
    })

    it('renders only the collapsed page, not the whole contact set', () => {
        const tree = render(45)

        expect(rows(tree)).toBe(10)
        expect(ghosts(tree)).toHaveLength(0)
        expect(showMore(tree).props.expanded).toBe(false)
        expect(showMore(tree).props.loading).toBeFalsy()
    })

    it('shows ghosts for the incoming page and dims the button while it is in flight', () => {
        const tree = render(45)

        act(() => showMore(tree).props.expand())

        // Still 10 real rows - the ghosts are covering the page that has not mounted yet.
        expect(rows(tree)).toBe(10)
        const [skeleton] = ghosts(tree)
        expect(skeleton).toBeDefined()
        // GHOST_MAX_ROWS caps the requested page of 10 at 6 so an expansion cannot paint a
        // screenful of grey.
        expect(skeleton.props.rowCount).toBe(6)
        expect(showMore(tree).props.loading).toBe(true)
    })

    it('retires the ghosts once the page is on screen', () => {
        const tree = render(45)

        act(() => showMore(tree).props.expand())
        flushFrames(frames)
        flushFrames(frames)

        expect(rows(tree)).toBe(20)
        expect(ghosts(tree)).toHaveLength(0)
        expect(showMore(tree).props.loading).toBe(false)
        expect(showMore(tree).props.expanded).toBe(true)
    })

    it('grows one page per press instead of revealing everything at once', () => {
        const tree = render(45)

        act(() => showMore(tree).props.expand())
        flushFrames(frames)
        flushFrames(frames)
        expect(rows(tree)).toBe(20)

        act(() => showMore(tree).props.expand())
        flushFrames(frames)
        flushFrames(frames)
        expect(rows(tree)).toBe(30)
    })

    it('ignores a second press while the first page is still in flight', () => {
        const tree = render(45)

        act(() => showMore(tree).props.expand())
        act(() => showMore(tree).props.expand())
        flushFrames(frames)
        flushFrames(frames)

        expect(rows(tree)).toBe(20)
    })

    it('collapses straight back to the first page with no ghosts', () => {
        const tree = render(45)

        act(() => showMore(tree).props.expand())
        flushFrames(frames)
        flushFrames(frames)
        expect(rows(tree)).toBe(20)

        act(() => showMore(tree).props.contract())

        expect(rows(tree)).toBe(10)
        expect(ghosts(tree)).toHaveLength(0)
        expect(showMore(tree).props.expanded).toBe(false)
    })

    it('hides the button when everything already fits on the first page', () => {
        const tree = render(6)

        expect(rows(tree)).toBe(6)
        expect(tree.root.findAllByType('ShowMoreButton')).toHaveLength(0)
    })

    it('sizes the ghosts to the real remainder when it is smaller than a page', () => {
        const tree = render(13)

        act(() => showMore(tree).props.expand())

        expect(ghosts(tree)[0].props.rowCount).toBe(3)
    })
})
