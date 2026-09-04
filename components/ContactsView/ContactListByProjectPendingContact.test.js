import React from 'react'
import renderer, { act } from 'react-test-renderer'

import ContactListByProject from './ContactListByProject'
import { PENDING_CONTACT_FLAG } from '../../utils/backends/Contacts/pendingContact'

/**
 * AT-2508 — a contact that is still being written gets a row of its own.
 *
 * The wiring, not the pixels (`PendingContactItem.test.js` covers those): the list has to draw
 * the pending contact as an inert progress row, hand it back to the ordinary interactive row the
 * moment the snapshot settles it, and be completely unchanged for every project where nothing is
 * pending.
 *
 * A/B: the first two blocks fail against the pre-AT-2508 code — there the pending contact would
 * be rendered as a fully interactive `DismissibleItem`/`ContactItem` pair over a document that
 * does not exist yet (in practice it never got that far, because nothing published one).
 */

jest.mock('./ContactsListSkeleton', () => 'ContactsListSkeleton')
jest.mock('./ContactItem', () => 'ContactItem')
jest.mock('./EditContact', () => 'EditContact')
jest.mock('./NewContactSection', () => 'NewContactSection')
jest.mock('./ContactsHeader', () => 'ContactsHeader')
jest.mock('./PendingContactItem', () => 'PendingContactItem')
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
    // Newest first, which is what `sortContactsFn` does by `lastEditionDate` — so a contact just
    // added lands at the top of the list, right under the add form the user typed into.
    default: { sortContactsFn: (a, b) => (b.lastEditionDate || 0) - (a.lastEditionDate || 0) },
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

const settled = (uid, lastEditionDate = 1) => ({
    uid,
    displayName: `Contact ${uid}`,
    recorderUserId: 'user-1',
    lastEditionDate,
})

const pending = (uid, lastEditionDate = 100) => ({ ...settled(uid, lastEditionDate), [PENDING_CONTACT_FLAG]: true })

const render = contacts => {
    let tree
    act(() => {
        tree = renderer.create(
            <ContactListByProject
                projectIndex={0}
                members={[]}
                contacts={contacts}
                onlyMembers={false}
                maxContactsToRender={10}
                requestProjectData={false}
            />
        )
    })
    return tree
}

const pendingRows = tree => tree.root.findAllByType('PendingContactItem')
const interactiveRows = tree => tree.root.findAllByType('DismissibleItem')

describe('a contact that is still being written', () => {
    it('gets an inert pending row instead of the interactive one', () => {
        const tree = render([settled('a'), pending('new-1')])

        expect(pendingRows(tree)).toHaveLength(1)
        // ...and the row over a document that does not exist yet is NOT swipeable, pressable or
        // editable: only the settled contact gets the interactive treatment.
        expect(interactiveRows(tree)).toHaveLength(1)
    })

    it('is handed the contact, so the row shows the name the user actually typed', () => {
        const tree = render([pending('new-1')])

        expect(pendingRows(tree)[0].props.contact.displayName).toBe('Contact new-1')
    })

    it('sits at the top of the list, where the add form the user typed into is', () => {
        const tree = render([settled('old', 1), pending('new-1', 100)])

        const order = tree.root
            .findAllByType('PendingContactItem')
            .concat(tree.root.findAllByType('DismissibleItem'))
            .map(node => node.props.contact?.uid || node.key)

        expect(order[0]).toBe('new-1')
    })

    it('renders several at once when the user adds people in a row', () => {
        const tree = render([settled('a'), pending('new-1'), pending('new-2')])

        expect(pendingRows(tree)).toHaveLength(2)
        expect(interactiveRows(tree)).toHaveLength(1)
    })
})

describe('when the snapshot settles it', () => {
    it('becomes the ordinary interactive row, with no gap and no duplicate', () => {
        const tree = render([settled('a'), pending('new-1')])
        expect(pendingRows(tree)).toHaveLength(1)

        // What `mergePendingContacts` produces once the access projection has landed.
        act(() => {
            tree.update(
                <ContactListByProject
                    projectIndex={0}
                    members={[]}
                    contacts={[settled('a'), settled('new-1', 100)]}
                    onlyMembers={false}
                    maxContactsToRender={10}
                />
            )
        })

        expect(pendingRows(tree)).toHaveLength(0)
        expect(interactiveRows(tree)).toHaveLength(2)
    })
})

describe('when nothing is pending', () => {
    it('renders exactly what it always did', () => {
        const tree = render([settled('a'), settled('b'), settled('c')])

        expect(pendingRows(tree)).toHaveLength(0)
        expect(interactiveRows(tree)).toHaveLength(3)
    })
})
