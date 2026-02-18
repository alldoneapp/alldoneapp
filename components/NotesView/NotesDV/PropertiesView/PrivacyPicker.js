import React from 'react'
import GhostButton from '../../../UIControls/GhostButton'
import Backend from '../../../../utils/BackendBridge'
import { updateNotePrivacy } from '../../../../utils/backends/Notes/notesFirestore'
import { translate } from '../../../../i18n/TranslationService'

export default function PrivacyPicker({ projectId, note, disabled }) {
    const onPress = () => {
        updateNotePrivacy(projectId, note.id, !note.isPrivate, note.followersIds, false, note)
    }

    return (
        <GhostButton
            type={'ghost'}
            icon={note.isPrivate ? 'lock' : 'unlock'}
            title={note.isPrivate ? translate('Private') : translate('Project-wide')}
            onPress={onPress}
            pressed={note.isPrivate}
            disabled={disabled}
        />
    )
}
