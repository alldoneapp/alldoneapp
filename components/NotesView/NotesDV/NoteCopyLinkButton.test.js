/**
 * @jest-environment jsdom
 */

import React from 'react'
import renderer, { act } from 'react-test-renderer'

import NoteCopyLinkButton, { getNoteEditorLink, shouldAskBeforeCopyingNoteLink } from './NoteCopyLinkButton'
import { getNotePublicLinkOptions } from './NotePublicLinkModal'
import { copyTextToClipboard } from '../../../utils/HelperFunctions'
import { setNotePublicLink } from '../../../utils/backends/Notes/notesFirestore'

// "Copy link" on a note of a private project warns that only members can open the address, and
// offers to open just this note to anyone with the link (its public link, hasPublicNoteLink in
// firestore.rules).

jest.mock('react-redux', () => ({
    useDispatch: () => jest.fn(),
    useSelector: selector =>
        selector({
            loggedUser: { sidebarExpanded: true },
            isMiddleScreenNoteDV: false,
            smallScreenNavigation: false,
        }),
}))
jest.mock('react-hot-keys', () => props => props.children)
jest.mock('../../Icon', () => () => null)
jest.mock('../../UIControls/Shortcut', () => () => null)
jest.mock('../../UIControls/CopyLinkButton', () => {
    const { Text } = require('react-native')
    return () => <Text>plain copy link</Text>
})
jest.mock('../../UIComponents/FloatModals/DueDateModal/Header', () => () => null)
jest.mock('../../UIComponents/ModalShell/AppPopover', () => props => (
    <>
        {props.children}
        {props.isOpen ? props.content : null}
    </>
))
jest.mock('../../../hooks/useEscapeKey', () => () => {})
jest.mock('../../../utils/HelperFunctions', () => ({ applyPopoverWidth: () => ({}), copyTextToClipboard: jest.fn() }))
jest.mock('../../../utils/LinkingHelper', () => ({ getAppLinkOrigin: () => 'https://my.alldone.app' }))
jest.mock('../../../utils/backends/Notes/notesFirestore', () => ({ setNotePublicLink: jest.fn() }))
jest.mock('../../../redux/actions', () => ({ showFloatPopup: () => ({}), hideFloatPopup: () => ({}) }))
jest.mock('../../../i18n/TranslationService', () => ({ translate: text => text }))
jest.mock('../../SettingsView/ProjectsSettings/ProjectHelper', () => ({ PROJECT_PRIVATE: 2 }))

const PRIVATE_PROJECT = { id: 'p1', isShared: 2 }
const PUBLIC_PROJECT = { id: 'p1', isShared: 0 }
const LINK = 'https://my.alldone.app/projects/p1/notes/n1/editor'

const press = (tree, testID) =>
    act(async () => {
        tree.root.findByProps({ testID }).props.onPress({ preventDefault() {}, stopPropagation() {} })
    })

describe('when Copy link asks first', () => {
    it('asks for a private project, or to manage a link that is already open', () => {
        const note = { id: 'n1' }
        expect(shouldAskBeforeCopyingNoteLink({ project: PRIVATE_PROJECT, note, canEdit: true })).toBe(true)
        expect(shouldAskBeforeCopyingNoteLink({ project: PUBLIC_PROJECT, note, canEdit: true })).toBe(false)
        expect(
            shouldAskBeforeCopyingNoteLink({
                project: PUBLIC_PROJECT,
                note: { ...note, publicLinkEnabled: true },
                canEdit: true,
            })
        ).toBe(true)
        // A viewer who cannot edit the note cannot open or close its link: plain copy.
        expect(shouldAskBeforeCopyingNoteLink({ project: PRIVATE_PROJECT, note, canEdit: false })).toBe(false)
    })

    it('offers the override while the link is off and turning it off while it is on', () => {
        expect(getNotePublicLinkOptions(false).map(option => option.action)).toEqual(['members', 'enable'])
        expect(getNotePublicLinkOptions(true).map(option => option.action)).toEqual(['copyPublic', 'disable'])
    })

    it('links to the note editor on the app origin', () => {
        expect(getNoteEditorLink('p1', 'n1')).toBe(LINK)
    })
})

describe('NoteCopyLinkButton', () => {
    beforeEach(() => jest.clearAllMocks())

    it('keeps the plain copy button in a project shared with link', () => {
        const tree = renderer.create(
            <NoteCopyLinkButton projectId="p1" note={{ id: 'n1' }} project={PUBLIC_PROJECT} canEdit />
        )
        expect(tree.root.findAllByProps({ testID: 'note-copy-link-button' })).toHaveLength(0)
    })

    it('copies the members-only link without opening the note', async () => {
        const tree = renderer.create(
            <NoteCopyLinkButton projectId="p1" note={{ id: 'n1' }} project={PRIVATE_PROJECT} canEdit />
        )
        await press(tree, 'note-copy-link-button')
        await press(tree, 'note-public-link-members')

        expect(copyTextToClipboard).toHaveBeenCalledWith(LINK)
        expect(setNotePublicLink).not.toHaveBeenCalled()
        expect(tree.root.findAllByProps({ testID: 'note-public-link-modal' })).toHaveLength(0)
    })

    it('copies inside the click, then opens the note to anyone with the link', async () => {
        let resolveWrite
        setNotePublicLink.mockReturnValue(new Promise(resolve => (resolveWrite = resolve)))
        const tree = renderer.create(
            <NoteCopyLinkButton projectId="p1" note={{ id: 'n1' }} project={PRIVATE_PROJECT} canEdit />
        )
        await press(tree, 'note-copy-link-button')
        await press(tree, 'note-public-link-enable')

        // The clipboard write happens before the server round trip (user gesture).
        expect(copyTextToClipboard).toHaveBeenCalledWith(LINK)
        expect(setNotePublicLink).toHaveBeenCalledWith('p1', 'n1', true)
        await act(async () => resolveWrite())
        expect(tree.root.findAllByProps({ testID: 'note-public-link-modal' })).toHaveLength(0)
    })

    it('stays open with an error when opening the link fails', async () => {
        setNotePublicLink.mockRejectedValue(new Error('permission-denied'))
        jest.spyOn(console, 'warn').mockImplementation(() => {})
        const tree = renderer.create(
            <NoteCopyLinkButton projectId="p1" note={{ id: 'n1' }} project={PRIVATE_PROJECT} canEdit />
        )
        await press(tree, 'note-copy-link-button')
        await press(tree, 'note-public-link-enable')

        expect(tree.root.findAllByProps({ testID: 'note-public-link-error' }).length).toBeGreaterThan(0)
        console.warn.mockRestore()
    })

    it('turns an open link off', async () => {
        setNotePublicLink.mockResolvedValue()
        const tree = renderer.create(
            <NoteCopyLinkButton
                projectId="p1"
                note={{ id: 'n1', publicLinkEnabled: true }}
                project={PRIVATE_PROJECT}
                canEdit
            />
        )
        await press(tree, 'note-copy-link-button')
        await press(tree, 'note-public-link-disable')

        expect(setNotePublicLink).toHaveBeenCalledWith('p1', 'n1', false)
        expect(copyTextToClipboard).not.toHaveBeenCalled()
    })
})
