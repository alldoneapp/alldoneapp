/**
 * @jest-environment jsdom
 *
 * AT-2508 - the mentions "create contact" card must not freeze when the write fails.
 *
 * It had no rejection handler at all: `stopLoadingData()` and `setSendingData(false)` lived only
 * inside the completion callback, which a rejected write never reaches. One failure therefore
 * left the card disabled forever AND pinned the global loading refcount, so the app-wide spinner
 * span for the rest of the session. Exactly the defect AT-2488 fixed in `CreateNote`.
 *
 * A/B: the two failure cases fail against the pre-AT-2508 code; the success case passes in both.
 */

import React from 'react'
import renderer, { act } from 'react-test-renderer'

import CreateContact from './CreateContact'
import { addContactToProject } from '../../../utils/backends/Contacts/contactsFirestore'

jest.mock('../../../utils/backends/Contacts/contactsFirestore', () => ({
    addContactToProject: jest.fn(),
}))

const mockDispatch = jest.fn()
jest.mock('react-redux', () => ({
    // The card transitively pulls in `redux/store`, whose module graph reaches a `connect()`
    // call site, so the mock has to carry one even though nothing here uses it.
    connect: () => component => component,
    useDispatch: () => mockDispatch,
    useSelector: selector =>
        selector({
            loggedUser: { uid: 'user-1' },
            smallScreenNavigation: false,
            isMiddleScreen: false,
            mentionModalStack: [],
            projectContacts: {},
            loggedUserProjects: [{ id: 'project-1', index: 0 }],
        }),
}))

jest.mock('../../../redux/store', () => ({
    __esModule: true,
    default: {
        getState: () => ({ mentionModalStack: [], loggedUser: { uid: 'user-1' }, contactStatusFilter: null }),
        dispatch: jest.fn(),
        subscribe: () => jest.fn(),
    },
}))

jest.mock('../../../redux/actions', () => ({
    startLoadingData: () => ({ type: 'Start loading data' }),
    stopLoadingData: () => ({ type: 'Stop loading data' }),
    setSelectedNavItem: () => ({ type: 'noop' }),
}))

jest.mock('../../Feeds/CommentsTextInput/CustomTextInput3', () => 'CustomTextInput3')
jest.mock('../Common/PlusButton', () => 'PlusButton')
jest.mock('../../../i18n/TranslationService', () => ({
    translate: key => key,
    // `redux/store` seeds its default user language from this at module load.
    getDeviceLanguage: () => 'en',
}))
jest.mock('../../../utils/NavigationService', () => ({ __esModule: true, default: { navigate: jest.fn() } }))
jest.mock('../../SettingsView/ProjectsSettings/ProjectHelper', () => ({
    __esModule: true,
    default: {
        getProjectIndexById: () => 0,
        getUserRoleInProject: (projectId, uid, role) => role,
        getUserCompanyInProject: (projectId, uid, company) => company,
        getUserDescriptionInProject: (projectId, uid, description) => description,
        getUserHighlightInProject: () => '#FFFFFF',
        checkIfLoggedUserIsNormalUserInGuide: () => false,
    },
}))

const countDispatches = type => mockDispatch.mock.calls.filter(([action]) => action && action.type === type).length

beforeEach(() => {
    jest.clearAllMocks()
    jest.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
    console.error.mockRestore()
})

describe('CreateContact (mentions card)', () => {
    /**
     * The card is a function component, so its submit handler is reached through the button it
     * renders rather than through an instance.
     */
    const renderCard = () => {
        let tree
        act(() => {
            tree = renderer.create(<CreateContact projectId="project-1" />)
        })
        return tree
    }

    const submitWith = async (tree, name) => {
        const input = tree.root.findByType('CustomTextInput3')
        act(() => {
            input.props.onChangeText(name)
        })
        const button = tree.root.findByType('PlusButton')
        await act(async () => {
            // Pre-AT-2508 the rejection escaped the card entirely as an unhandled rejection;
            // swallow it here so these cases assert on the card's STATE either way.
            await Promise.resolve(button.props.onPress()).catch(() => {})
        })
    }

    it('gives the loading refcount back when the write fails', async () => {
        addContactToProject.mockRejectedValue(new Error('permission-denied'))
        const tree = renderCard()

        await submitWith(tree, 'David Massanek')

        expect(countDispatches('Start loading data')).toBe(1)
        // Was 0 before AT-2508: the stop only ran on success.
        expect(countDispatches('Stop loading data')).toBe(1)
        tree.unmount()
    })

    it('re-enables the card so the failure can be retried', async () => {
        addContactToProject.mockRejectedValue(new Error('permission-denied'))
        const tree = renderCard()

        await submitWith(tree, 'David Massanek')

        // `disabled` is `!name || sendingData`, and the name is still there - so a disabled
        // button here means `sendingData` was never given back and the card is stuck.
        expect(tree.root.findByType('PlusButton').props.disabled).toBe(false)
        tree.unmount()
    })

    it('still balances the refcount on success', async () => {
        addContactToProject.mockImplementation(async (projectId, contact, onComplete) => {
            if (onComplete) onComplete({ uid: 'minted', ...contact })
        })
        const tree = renderCard()

        await submitWith(tree, 'David Massanek')

        expect(countDispatches('Start loading data')).toBe(1)
        expect(countDispatches('Stop loading data')).toBe(1)
        tree.unmount()
    })
})
