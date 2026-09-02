import React from 'react'
import renderer, { act } from 'react-test-renderer'

import CreateNote from './CreateNote'
import { uploadNewNote } from '../../../utils/backends/Notes/notesFirestore'
import { startLoadingData, stopLoadingData } from '../../../redux/actions'

/**
 * AT-2488 — the mentions "create note" card had no rejection handler at all.
 *
 * `uploadNewNote(...).then(onSuccess)` with nothing after it meant a failed write
 * left `sendingData` true forever: the input stayed locked, the plus button stayed
 * disabled, and the global loading refcount was never decremented — so the app-wide
 * spinner kept turning for the rest of the session. The card looked frozen, and the
 * only way out was to close it and lose the typed title.
 *
 * These tests are about the failure path specifically; the success path is
 * unchanged and is asserted here only to prove the rewrite did not move it.
 */

jest.mock('../../../i18n/TranslationService', () => ({
    ...jest.requireActual('../../../i18n/TranslationService'),
    translate: key => key,
}))

jest.mock('../../../utils/backends/Notes/notesFirestore', () => ({ uploadNewNote: jest.fn() }))

jest.mock('../../../utils/NavigationService', () => ({ __esModule: true, default: { navigate: jest.fn() } }))

jest.mock('../../../utils/BackendBridge', () => ({
    __esModule: true,
    default: { setLinkedParentObjects: jest.fn() },
}))

jest.mock('../../Feeds/CommentsTextInput/CustomTextInput3', () => {
    const React = require('react')
    return React.forwardRef((props, ref) => {
        React.useImperativeHandle(ref, () => ({ clear: jest.fn(), focus: jest.fn() }))
        return React.createElement('CustomTextInput3', props)
    })
})

jest.mock('../../UIComponents/FloatModals/ManageTaskModal/PrivacyWrapper', () => 'PrivacyWrapper')
jest.mock('../../UIComponents/FloatModals/ManageTaskModal/HighlightWrapper', () => 'HighlightWrapper')
jest.mock('./StickyWrapper', () => 'StickyWrapper')
jest.mock('../Common/PlusButton', () => 'PlusButton')
jest.mock('../../Icon', () => 'Icon')

jest.mock('../../SettingsView/ProjectsSettings/ProjectHelper', () => ({
    __esModule: true,
    default: { getProjectById: () => ({ id: 'project-1', userIds: [] }) },
}))

const mockDispatch = jest.fn()
// Only `useDispatch` is swapped: the import chain reaches @hello-pangea/dnd, which
// needs the real `connect`.
jest.mock('react-redux', () => ({
    ...jest.requireActual('react-redux'),
    useDispatch: () => mockDispatch,
}))

jest.mock('../../../redux/store', () => {
    const importTimeState = {
        loggedUser: { uid: 'user-1' },
        currentUser: { uid: 'user-1' },
        mentionModalStack: ['modal-1'],
        projectUsers: {},
    }
    return {
        __esModule: true,
        default: { getState: jest.fn(() => importTimeState), dispatch: jest.fn(), subscribe: jest.fn(() => jest.fn()) },
    }
})

const flush = async () => {
    await act(async () => {
        await Promise.resolve()
        await Promise.resolve()
    })
}

const findByTestID = (tree, testID) => tree.root.findAllByProps({ testID }, { deep: false })
const plusButton = tree => tree.root.findByType('PlusButton')

describe('CreateNote — failed creation (AT-2488)', () => {
    let tree

    const renderCard = async () => {
        await act(async () => {
            tree = renderer.create(<CreateNote projectId="project-1" modalId="modal-1" />)
        })
    }

    const type = async (title = 'A mentioned note') => {
        const input = tree.root.findByType('CustomTextInput3')
        await act(async () => {
            input.props.onChangeText(title, [], [], [], [], [], [], [])
        })
    }

    const submit = async () => {
        await act(async () => {
            plusButton(tree).props.onPress()
        })
    }

    beforeEach(() => {
        jest.clearAllMocks()
    })

    afterEach(() => {
        if (tree) act(() => tree.unmount())
        tree = undefined
    })

    it('shows progress while the write is in flight', async () => {
        uploadNewNote.mockReturnValue(new Promise(() => {}))

        await renderCard()
        await type()
        await submit()

        expect(plusButton(tree).props.processing).toBe(true)
        expect(plusButton(tree).props.disabled).toBe(true)
        expect(tree.root.findByType('CustomTextInput3').props.disabledEdition).toBe(true)
        expect(mockDispatch).toHaveBeenCalledWith(startLoadingData())
    })

    it('unlocks the card, stops the global spinner and explains the failure', async () => {
        uploadNewNote.mockRejectedValue(new Error('offline'))
        jest.spyOn(console, 'error').mockImplementation(() => {})

        await renderCard()
        await type()
        await submit()
        await flush()

        // The three halves of the stuck state, all of which used to persist forever.
        expect(plusButton(tree).props.processing).toBe(false)
        expect(tree.root.findByType('CustomTextInput3').props.disabledEdition).toBe(false)
        expect(mockDispatch).toHaveBeenCalledWith(stopLoadingData())

        const error = findByTestID(tree, 'create-note-creation-error')
        expect(error).toHaveLength(1)
        expect(error[0].props.accessibilityRole).toBe('alert')

        console.error.mockRestore()
    })

    it('allows a retry after a failure', async () => {
        uploadNewNote.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({ id: 'note-1' })
        jest.spyOn(console, 'error').mockImplementation(() => {})

        await renderCard()
        await type()
        await submit()
        await flush()

        await submit()
        await flush()

        expect(uploadNewNote).toHaveBeenCalledTimes(2)
        // The error clears once the retry is under way, rather than lingering next
        // to a note that is now being created.
        expect(findByTestID(tree, 'create-note-creation-error')).toHaveLength(0)

        console.error.mockRestore()
    })

    it('still creates the note on the success path', async () => {
        uploadNewNote.mockResolvedValue({ id: 'note-1' })

        await renderCard()
        await type()
        await submit()
        await flush()

        expect(uploadNewNote).toHaveBeenCalledWith('project-1', expect.objectContaining({ title: 'A mentioned note' }))
        expect(mockDispatch).toHaveBeenCalledWith(stopLoadingData())
        expect(findByTestID(tree, 'create-note-creation-error')).toHaveLength(0)
    })
})
