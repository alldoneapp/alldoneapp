import React from 'react'
import renderer, { act } from 'react-test-renderer'

import EditNote from './EditNote'
import store from '../../redux/store'
import NavigationService from '../../utils/NavigationService'
import { uploadNewNote } from '../../utils/backends/Notes/notesFirestore'

/**
 * AT-2488 — "creating a note" has to be visible.
 *
 * The defect this pins is a TIMING one, not a styling one: `updateNote` fired the
 * write and then called `resetEditMode()` on the very next statement, so the form
 * was gone before the write had even started travelling. The user was left looking
 * at an unchanged list — no spinner, no row, no message — until the view suddenly
 * became the new note. Nothing was broken, so nothing was reported except "I think
 * something went wrong".
 *
 * So every assertion here is about WHEN the form goes away relative to the promise
 * settling, and about what the form says while it is still there. A test that only
 * rendered `creatingNote: true` and looked for a spinner would pass against the old
 * code too, because the old code never got to render that state at all — it is
 * `onCancelAction` NOT having been called mid-flight that is the regression guard.
 */

// `translate` is stubbed to the key, but the rest of the module has to stay real:
// EditNote's import chain reaches SharedHelper, which calls getDeviceLanguage() at
// module scope.
jest.mock('../../i18n/TranslationService', () => ({
    ...jest.requireActual('../../i18n/TranslationService'),
    translate: key => key,
}))

jest.mock('../../utils/backends/Notes/notesFirestore', () => ({
    uploadNewNote: jest.fn(),
    updateNoteHighlight: jest.fn(),
    updateNoteMeta: jest.fn(),
    updateNotePrivacy: jest.fn(),
    updateNoteStickyData: jest.fn(),
}))

jest.mock('../../utils/backends/Chats/chatsFirestore', () => ({ updateChatTitleWithoutFeeds: jest.fn() }))

jest.mock('../../utils/NavigationService', () => ({
    __esModule: true,
    default: { navigate: jest.fn() },
}))

jest.mock('../../utils/BackendBridge', () => ({
    __esModule: true,
    default: { setLinkedParentObjects: jest.fn() },
}))

// The editor itself is a full Quill host; only its imperative surface matters here.
jest.mock('../Feeds/CommentsTextInput/CustomTextInput3', () => {
    const React = require('react')
    return React.forwardRef((props, ref) => {
        React.useImperativeHandle(ref, () => ({ clear: jest.fn(), focus: jest.fn() }))
        return React.createElement('CustomTextInput3', props)
    })
})

jest.mock('../UIControls/Button', () => 'Button')
jest.mock('../UIControls/StickyButton', () => 'StickyButton')
jest.mock('../UIComponents/FloatModals/PrivacyModal/PrivacyButton', () => 'PrivacyButton')
jest.mock('../UIComponents/FloatModals/HighlightColorModal/HighlightButton', () => 'HighlightButton')
jest.mock('../UIComponents/FloatModals/MorePopupsOfEditModals/Notes/NoteMoreButton', () => 'NoteMoreButton')
jest.mock('../UIComponents/Spinner', () => 'Spinner')
jest.mock('../Icon', () => 'Icon')
jest.mock('react-hot-keys', () => 'Hotkeys')

jest.mock('../SettingsView/ProjectsSettings/ProjectHelper', () => ({
    __esModule: true,
    default: { checkIfLoggedUserIsNormalUserInGuide: () => false },
}))

jest.mock('../../utils/HelperFunctions', () => ({
    dismissAllPopups: jest.fn(),
    execShortcutFn: jest.fn(),
}))

// The factory has to answer at IMPORT time too: EditNote.defaultProps calls
// TasksHelper.getNewDefaultNote(), which reads the store while the module loads.
jest.mock('../../redux/store', () => {
    const importTimeState = {
        loggedUser: { uid: 'user-1' },
        currentUser: { uid: 'user-1' },
        smallScreen: false,
        smallScreenNavigation: false,
        taskViewToggleSection: {},
        projectUsers: {},
        inBacklinksView: false,
        showGlobalSearchPopup: false,
        showFloatPopup: 0,
        tmpInputTextNote: '',
        blockShortcuts: false,
    }
    return {
        __esModule: true,
        default: {
            getState: jest.fn(() => importTimeState),
            dispatch: jest.fn(),
            subscribe: jest.fn(() => jest.fn()),
        },
    }
})

const LOGGED_USER = { uid: 'user-1' }

const baseState = {
    loggedUser: LOGGED_USER,
    currentUser: LOGGED_USER,
    smallScreen: false,
    smallScreenNavigation: false,
    taskViewToggleSection: {},
    projectUsers: { 'project-1': [] },
    inBacklinksView: false,
    showGlobalSearchPopup: false,
    showFloatPopup: 0,
    tmpInputTextNote: '',
    blockShortcuts: false,
}

const flush = async () => {
    await act(async () => {
        await Promise.resolve()
        await Promise.resolve()
    })
}

const findByTestID = (tree, testID) => tree.root.findAllByProps({ testID }, { deep: false })

// The submit button is the last <Button> in the tree (the form's primary action).
const submitButton = tree => {
    const buttons = tree.root.findAllByType('Button')
    return buttons[buttons.length - 1]
}

describe('EditNote — new note creation progress (AT-2488)', () => {
    let onCancelAction
    let tree

    const renderForm = async () => {
        await act(async () => {
            tree = renderer.create(
                <EditNote
                    formType="new"
                    project={{ id: 'project-1' }}
                    projectId="project-1"
                    onCancelAction={onCancelAction}
                    defaultDate={Date.now()}
                />
            )
        })
        return tree
    }

    // Typing is what makes the note submittable (`noteChanged`).
    const type = async (title = 'My new note') => {
        const input = tree.root.findByType('CustomTextInput3')
        await act(async () => {
            input.props.onChangeText(title, [], [], [], [], [], [], [])
        })
    }

    // Submitting the way the user does: pressing the form's primary button.
    const submit = async () => {
        await act(async () => {
            submitButton(tree).props.onPress()
        })
    }

    beforeEach(() => {
        jest.clearAllMocks()
        store.getState.mockReturnValue(baseState)
        onCancelAction = jest.fn()
    })

    afterEach(() => {
        if (tree) act(() => tree.unmount())
        tree = undefined
    })

    it('keeps the form on screen and shows progress while the write is in flight', async () => {
        let resolveUpload
        uploadNewNote.mockReturnValue(new Promise(resolve => (resolveUpload = resolve)))

        await renderForm()
        await type()
        await submit()

        // THE regression guard: the form used to be dismissed synchronously here.
        expect(onCancelAction).not.toHaveBeenCalled()

        expect(findByTestID(tree, 'edit-note-creating-spinner')).toHaveLength(1)

        const button = submitButton(tree)
        expect(button.props.processing).toBe(true)
        expect(button.props.processingTitle).toBe('Creating Note...')
        expect(button.props.disabled).toBe(true)

        // The text is locked so the title cannot drift away from what is being written.
        expect(tree.root.findByType('CustomTextInput3').props.disabledEdition).toBe(true)

        await act(async () => {
            resolveUpload({ id: 'note-1' })
        })
    })

    it('dismisses the form and navigates once the note exists — with no artificial delay', async () => {
        // Fake timers so "nothing is waiting on a clock" is actually observable.
        jest.useFakeTimers()
        uploadNewNote.mockResolvedValue({ id: 'note-1' })

        await renderForm()
        await type()
        await submit()
        await flush()

        expect(onCancelAction).toHaveBeenCalledTimes(1)
        expect(NavigationService.navigate).toHaveBeenCalledWith('NotesDetailedView', {
            noteId: 'note-1',
            projectId: 'project-1',
        })

        // `flush()` only drains microtasks — it never advances a timer. The 100ms
        // setTimeout that used to sit between the dispatch and the navigation would
        // therefore leave `navigate` uncalled here, so the assertion above IS the
        // no-artificial-delay guard. Belt and braces: nothing is left pending.
        expect(jest.getTimerCount()).toBe(0)

        jest.useRealTimers()
    })

    it('keeps the form open with an error when creation fails, preserving the typed title', async () => {
        uploadNewNote.mockRejectedValue(new Error('offline'))
        jest.spyOn(console, 'error').mockImplementation(() => {})

        await renderForm()
        await type('Note that fails')
        await submit()
        await flush()

        // A failure used to close the form and drop the text without a word.
        expect(onCancelAction).not.toHaveBeenCalled()
        expect(NavigationService.navigate).not.toHaveBeenCalled()

        const error = findByTestID(tree, 'edit-note-creation-error')
        expect(error).toHaveLength(1)
        expect(error[0].props.accessibilityRole).toBe('alert')

        // Unlocked again, and the note the user typed is still the one staged.
        expect(submitButton(tree).props.processing).toBe(false)
        expect(tree.getInstance().state.tmpNote.title).toBe('Note that fails')

        console.error.mockRestore()
    })

    it('allows a retry after a failure', async () => {
        uploadNewNote.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({ id: 'note-2' })
        jest.spyOn(console, 'error').mockImplementation(() => {})

        await renderForm()
        await type()
        await submit()
        await flush()

        expect(uploadNewNote).toHaveBeenCalledTimes(1)

        // `submitOnce` is one-shot and saw the rejection as a resolution, so without
        // an explicit release the retry would be silently swallowed.
        await submit()
        await flush()

        expect(uploadNewNote).toHaveBeenCalledTimes(2)
        expect(NavigationService.navigate).toHaveBeenCalledWith('NotesDetailedView', {
            noteId: 'note-2',
            projectId: 'project-1',
        })

        console.error.mockRestore()
    })

    it('ignores Enter while a creation is in flight', async () => {
        let resolveUpload
        uploadNewNote.mockReturnValue(new Promise(resolve => (resolveUpload = resolve)))

        await renderForm()
        await type()
        await submit()

        await act(async () => {
            tree.getInstance().onKeyDown({ key: 'Enter' })
            submitButton(tree).props.onPress()
        })

        expect(uploadNewNote).toHaveBeenCalledTimes(1)
        expect(onCancelAction).not.toHaveBeenCalled()

        await act(async () => {
            resolveUpload({ id: 'note-1' })
        })
    })

    it('does not reopen a form that was dismissed while the write was in flight', async () => {
        let resolveUpload
        uploadNewNote.mockReturnValue(new Promise(resolve => (resolveUpload = resolve)))

        await renderForm()
        await type()
        await submit()

        // Escape / an outside click still dismisses: react-dismissible owns those and
        // unmounts the form. `onCancelAction` is a TOGGLE, so calling it from the
        // success continuation of an unmounted form would open a blank editor.
        await act(async () => {
            tree.unmount()
        })
        tree = undefined

        await act(async () => {
            resolveUpload({ id: 'note-1' })
            await Promise.resolve()
            await Promise.resolve()
        })

        expect(onCancelAction).not.toHaveBeenCalled()
        expect(NavigationService.navigate).toHaveBeenCalledWith('NotesDetailedView', {
            noteId: 'note-1',
            projectId: 'project-1',
        })
    })
})
