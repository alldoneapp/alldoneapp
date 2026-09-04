/**
 * @jest-environment jsdom
 *
 * AT-2508 - adding a person from the contacts list has to say that it is happening.
 *
 * The form used to tear itself down one statement after firing the write, so the user was left
 * looking at an unchanged list - the new row cannot appear until the server has written the
 * contact's `readerIds` projection, measured at 7.35s in production. It now stays up in an
 * "Adding person..." state until the write is acknowledged, and a FAILED creation keeps the form
 * and the typed name instead of silently dropping both.
 *
 * A/B: every case in the first three blocks fails against the pre-AT-2508 code.
 */

import React from 'react'
import { Provider } from 'react-redux'
import renderer, { act } from 'react-test-renderer'

import EditContact from '../../components/ContactsView/EditContact'
import store from '../../redux/store'
import { addContactToProject } from '../../utils/backends/Contacts/contactsFirestore'

// The name field embeds the Quill editor, whose unmount cleanup dereferences a ref that never
// gets an editor here. Nothing in this suite is about the editor, so stand it in.
jest.mock('../../components/Feeds/CommentsTextInput/CustomTextInput3', () => 'CustomTextInput3')

jest.mock('../../utils/backends/Contacts/contactsFirestore', () => ({
    addContactToProject: jest.fn(),
    copyContactToProject: jest.fn(),
    setProjectContactHighlight: jest.fn(),
    setProjectContactName: jest.fn(),
    setProjectContactPicture: jest.fn(),
}))

// The email branch writes an invitation and navigates away; both reach real Firestore.
jest.mock('../../utils/BackendBridge', () => ({
    __esModule: true,
    default: { inviteUserToProject: jest.fn() },
}))
jest.mock('../../utils/NavigationService', () => ({
    __esModule: true,
    default: { navigate: jest.fn() },
}))

const PROJECT_ID = 'project-1'

const render = (props = {}) => {
    const ref = React.createRef()
    let tree
    act(() => {
        tree = renderer.create(
            <Provider store={store}>
                <EditContact ref={ref} isNew={true} projectId={PROJECT_ID} onCancelAction={jest.fn()} {...props} />
            </Provider>
        )
    })
    return { tree, instance: ref.current }
}

/** Types a name into the form, the way `CustomTextInput3` would. */
const type = (instance, name) => {
    act(() => {
        instance.onChangeInputText(name)
    })
}

const primaryButton = tree => {
    const buttons = tree.root.findAllByProps({ type: 'primary' }, { deep: false })
    return buttons[buttons.length - 1]
}

const cancelButton = tree => tree.root.findAllByProps({ type: 'secondary' }, { deep: false })[0]

const findByTestID = (tree, testID) => tree.root.findAllByProps({ testID }, { deep: false })

/** A creation whose settlement this test controls. */
const deferredCreation = () => {
    let resolve
    let reject
    const promise = new Promise((res, rej) => {
        resolve = res
        reject = rej
    })
    addContactToProject.mockImplementation(() => promise)
    return {
        resolveWith: async contact => {
            // `addContactToProject` reports the created contact through its callback before it
            // resolves, so replay that ordering.
            const onComplete = addContactToProject.mock.calls[addContactToProject.mock.calls.length - 1][2]
            if (onComplete) onComplete(contact || { uid: 'minted-contact-id', displayName: 'David Massanek' })
            resolve()
            await act(async () => {
                await promise.catch(() => {})
            })
        },
        rejectWith: async error => {
            reject(error || new Error('permission-denied'))
            await act(async () => {
                await promise.catch(() => {})
            })
        },
    }
}

beforeEach(() => {
    jest.clearAllMocks()
    jest.spyOn(console, 'error').mockImplementation(() => {})
    store.dispatch({ type: 'Reset loading data' })
})

afterEach(() => {
    console.error.mockRestore()
    store.dispatch({ type: 'Reset loading data' })
})

describe('while the contact is being written', () => {
    it('keeps the form on screen instead of vanishing into an unchanged list', async () => {
        const onCancelAction = jest.fn()
        const { tree, instance } = render({ onCancelAction })
        type(instance, 'David Massanek')
        const creation = deferredCreation()

        act(() => {
            instance.addProjectContact()
        })

        expect(addContactToProject).toHaveBeenCalledTimes(1)
        // The whole defect: this used to have been called already, synchronously.
        expect(onCancelAction).not.toHaveBeenCalled()

        await creation.resolveWith()
        tree.unmount()
    })

    it('says what it is doing on the primary button', async () => {
        const { tree, instance } = render()
        type(instance, 'David Massanek')
        const creation = deferredCreation()

        act(() => {
            instance.addProjectContact()
        })

        expect(primaryButton(tree).props.processing).toBe(true)
        expect(primaryButton(tree).props.processingTitle).toBe('Adding person...')
        expect(primaryButton(tree).props.disabled).toBe(true)
        // The keyboard hint would be a lie while Enter is inert.
        expect(primaryButton(tree).props.shortcutText).toBe('')

        await creation.resolveWith()
        tree.unmount()
    })

    it('turns the leading "+" into a spinner, so the row itself is the progress indicator', async () => {
        const { tree, instance } = render()
        type(instance, 'David Massanek')
        const creation = deferredCreation()

        expect(findByTestID(tree, 'edit-contact-creating-spinner')).toHaveLength(0)

        act(() => {
            instance.addProjectContact()
        })

        expect(findByTestID(tree, 'edit-contact-creating-spinner')).toHaveLength(1)

        await creation.resolveWith()
        tree.unmount()
    })

    it('locks the text field and the action buttons against a second write', async () => {
        const { tree, instance } = render()
        type(instance, 'David Massanek')
        const creation = deferredCreation()

        act(() => {
            instance.addProjectContact()
        })

        expect(tree.root.findByType('CustomTextInput3').props.disabledEdition).toBe(true)
        expect(cancelButton(tree).props.disabled).toBe(true)

        await creation.resolveWith()
        tree.unmount()
    })

    it('ignores Enter rather than queueing a second creation', async () => {
        const { tree, instance } = render()
        type(instance, 'David Massanek')
        const creation = deferredCreation()

        act(() => {
            instance.addProjectContact()
        })
        act(() => {
            instance.enterActionKey()
            instance.addProjectContact()
        })

        expect(addContactToProject).toHaveBeenCalledTimes(1)

        await creation.resolveWith()
        tree.unmount()
    })
})

describe('when the contact is written', () => {
    it('closes the form exactly once, after the write is acknowledged', async () => {
        const onCancelAction = jest.fn()
        const { tree, instance } = render({ onCancelAction })
        type(instance, 'David Massanek')
        const creation = deferredCreation()

        act(() => {
            instance.addProjectContact()
        })
        expect(onCancelAction).not.toHaveBeenCalled()

        await creation.resolveWith()

        expect(onCancelAction).toHaveBeenCalledTimes(1)
        tree.unmount()
    })

    it('gives the global loading refcount back', async () => {
        const { tree, instance } = render()
        type(instance, 'David Massanek')
        const creation = deferredCreation()

        act(() => {
            instance.addProjectContact()
        })
        expect(store.getState().isLoadingData).toBe(1)

        await creation.resolveWith()

        expect(store.getState().isLoadingData).toBe(0)
        tree.unmount()
    })
})

describe('when the write fails', () => {
    it('keeps the form, keeps the typed name and explains itself', async () => {
        const onCancelAction = jest.fn()
        const { tree, instance } = render({ onCancelAction })
        type(instance, 'David Massanek')
        const creation = deferredCreation()

        act(() => {
            instance.addProjectContact()
        })
        await creation.rejectWith()

        // It used to close the form and drop the name with no message at all.
        expect(onCancelAction).not.toHaveBeenCalled()
        expect(instance.state.tmpContact.displayName).toBe('David Massanek')
        expect(findByTestID(tree, 'edit-contact-creation-error')).toHaveLength(1)
        expect(tree.root.findByProps({ accessibilityRole: 'alert' }, { deep: false })).toBeTruthy()
        tree.unmount()
    })

    it('unlocks the form so the failure can be retried', async () => {
        const { tree, instance } = render()
        type(instance, 'David Massanek')
        const failing = deferredCreation()

        act(() => {
            instance.addProjectContact()
        })
        await failing.rejectWith()

        expect(primaryButton(tree).props.processing).toBe(false)
        expect(primaryButton(tree).props.disabled).toBe(false)
        expect(tree.root.findByType('CustomTextInput3').props.disabledEdition).toBe(false)

        // The single-flight guard is one-shot and observed the handled rejection as a
        // resolution, so without an explicit release it would silently swallow the retry.
        const retry = deferredCreation()
        act(() => {
            instance.addProjectContact()
        })
        expect(addContactToProject).toHaveBeenCalledTimes(2)

        await retry.resolveWith()
        tree.unmount()
    })

    it('gives the global loading refcount back instead of pinning the app spinner forever', async () => {
        const { tree, instance } = render()
        type(instance, 'David Massanek')
        const creation = deferredCreation()

        act(() => {
            instance.addProjectContact()
        })
        await creation.rejectWith()

        // The stop used to live in the completion callback, which a rejected write never
        // reaches - so one failure left the spinner running for the rest of the session.
        expect(store.getState().isLoadingData).toBe(0)
        tree.unmount()
    })

    it('clears the error when the retry is submitted', async () => {
        const { tree, instance } = render()
        type(instance, 'David Massanek')
        const failing = deferredCreation()

        act(() => {
            instance.addProjectContact()
        })
        await failing.rejectWith()
        expect(findByTestID(tree, 'edit-contact-creation-error')).toHaveLength(1)

        const retry = deferredCreation()
        act(() => {
            instance.addProjectContact()
        })

        expect(findByTestID(tree, 'edit-contact-creation-error')).toHaveLength(0)

        await retry.resolveWith()
        tree.unmount()
    })
})

describe('preserved behaviour', () => {
    it('dismisses without writing anything when nothing was typed', () => {
        const onCancelAction = jest.fn()
        const { tree, instance } = render({ onCancelAction })

        act(() => {
            instance.addProjectContact()
        })

        expect(addContactToProject).not.toHaveBeenCalled()
        expect(onCancelAction).toHaveBeenCalledTimes(1)
        tree.unmount()
    })

    it('does not touch the form or the refcount when the name is an email invitation', () => {
        const onCancelAction = jest.fn()
        const { tree, instance } = render({ onCancelAction })
        type(instance, 'david@example.com')

        act(() => {
            instance.addProjectContact()
        })

        expect(addContactToProject).not.toHaveBeenCalled()
        expect(onCancelAction).toHaveBeenCalledTimes(1)
        expect(store.getState().isLoadingData).toBe(0)
        tree.unmount()
    })

    it('survives being dismissed while the write is still in flight', async () => {
        const { tree, instance } = render()
        type(instance, 'David Massanek')
        const creation = deferredCreation()

        act(() => {
            instance.addProjectContact()
        })
        // Escape and outside clicks deliberately still dismiss, so a hung write can never trap
        // the user; the continuation must notice that there is no component left to talk to.
        tree.unmount()

        await expect(creation.resolveWith()).resolves.not.toThrow()
    })
})
