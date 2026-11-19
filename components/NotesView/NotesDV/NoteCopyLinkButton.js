import React, { useState } from 'react'
import { StyleSheet, Text, TouchableOpacity } from 'react-native'
import { useDispatch, useSelector } from 'react-redux'

import Icon from '../../Icon'
import styles, { colors } from '../../styles/global'
import CopyLinkButton from '../../UIControls/CopyLinkButton'
import AppPopover from '../../UIComponents/ModalShell/AppPopover'
import NotePublicLinkModal, {
    NOTE_LINK_COPY_MEMBERS,
    NOTE_LINK_COPY_PUBLIC,
    NOTE_LINK_DISABLE,
    NOTE_LINK_ENABLE_AND_COPY,
} from './NotePublicLinkModal'
import { PROJECT_PRIVATE } from '../../SettingsView/ProjectsSettings/ProjectHelper'
import { copyTextToClipboard } from '../../../utils/HelperFunctions'
import { getAppLinkOrigin } from '../../../utils/LinkingHelper'
import { setNotePublicLink } from '../../../utils/backends/Notes/notesFirestore'
import { hideFloatPopup, showFloatPopup } from '../../../redux/actions'
import { translate } from '../../../i18n/TranslationService'

export const getNoteEditorLink = (projectId, noteId) =>
    `${getAppLinkOrigin()}/projects/${projectId}/notes/${noteId}/editor`

// "Copy link" asks first only where the plain address would not open the note for somebody outside
// the project: the project is private, or the note's public link is already on (so it can be turned
// off here). Everywhere else, and for a viewer who cannot edit the note, it copies at once as
// before.
export const shouldAskBeforeCopyingNoteLink = ({ project, note, canEdit }) =>
    !!canEdit && !!note && (note.publicLinkEnabled === true || project?.isShared === PROJECT_PRIVATE)

export default function NoteCopyLinkButton({ projectId, note, project, canEdit, style }) {
    const dispatch = useDispatch()
    const sidebarExpanded = useSelector(state => state.loggedUser.sidebarExpanded)
    const tablet = useSelector(state => state.isMiddleScreenNoteDV)
    const mobile = useSelector(state => state.smallScreenNavigation)
    const isMobile = sidebarExpanded ? tablet : mobile
    const [open, setOpen] = useState(false)

    if (!shouldAskBeforeCopyingNoteLink({ project, note, canEdit })) return <CopyLinkButton style={style} />

    const publicLinkEnabled = note.publicLinkEnabled === true
    const link = getNoteEditorLink(projectId, note.id)

    const openModal = () => {
        setOpen(true)
        dispatch(showFloatPopup())
    }

    const closeModal = () => {
        setOpen(false)
        dispatch(hideFloatPopup())
    }

    const onAction = async action => {
        if (action === NOTE_LINK_ENABLE_AND_COPY) {
            // Copy inside the click: the clipboard needs the user gesture, which an awaited server
            // round trip can outlive (Safari). The modal stays open with an error if the write fails.
            copyTextToClipboard(link)
            await setNotePublicLink(projectId, note.id, true)
        } else if (action === NOTE_LINK_DISABLE) {
            await setNotePublicLink(projectId, note.id, false)
        } else if (action === NOTE_LINK_COPY_PUBLIC || action === NOTE_LINK_COPY_MEMBERS) {
            copyTextToClipboard(link)
        }
        closeModal()
    }

    return (
        <AppPopover
            content={
                <NotePublicLinkModal
                    publicLinkEnabled={publicLinkEnabled}
                    onAction={onAction}
                    closeModal={closeModal}
                />
            }
            onClickOutside={closeModal}
            isOpen={open}
            padding={4}
            position={['bottom', 'left', 'right', 'top']}
            align={'end'}
            contentLocation={mobile ? null : undefined}
        >
            <TouchableOpacity
                onPress={openModal}
                style={[localStyles.container, style]}
                accessible={false}
                testID="note-copy-link-button"
            >
                <Icon name={publicLinkEnabled ? 'globe' : 'link'} size={18} color={colors.Text03} />
                {!isMobile && (
                    <Text style={localStyles.text}>{translate(publicLinkEnabled ? 'Public link' : 'Copy link')}</Text>
                )}
            </TouchableOpacity>
        </AppPopover>
    )
}

const localStyles = StyleSheet.create({
    container: {
        maxHeight: 32,
        minHeight: 32,
        borderWidth: 1,
        borderRadius: 4,
        flexDirection: 'row',
        backgroundColor: 'transparent',
        borderColor: colors.Gray400,
        alignItems: 'center',
        justifyContent: 'center',
        paddingVertical: 6,
        paddingHorizontal: 8,
    },
    text: {
        ...styles.caption1,
        color: colors.Text03,
        marginLeft: 8,
        marginRight: 4,
    },
})
