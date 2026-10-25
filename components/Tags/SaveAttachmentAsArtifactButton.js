import React from 'react'
import { Platform, StyleSheet, TouchableOpacity } from 'react-native'

import Icon from '../Icon'
import { colors } from '../styles/global'
import { translate } from '../../i18n/TranslationService'

// A file uploaded into a note. Inside an editor this is the only kind of attachment chip that gets
// the action: a comment composer's chip is a draft, and its file is not the user's to keep yet.
export function isNoteAttachmentUri(uri) {
    try {
        const url = new URL(String(uri || ''))
        if (url.hostname !== 'firebasestorage.googleapis.com') return false
        const encodedPath = url.pathname.split('/o/')[1] || ''
        return decodeURIComponent(encodedPath).startsWith('notesAttachments/')
    } catch (_) {
        return false
    }
}

// Uploads are already linked in Artifacts. Opening the list must never make a private copy.
export default function SaveAttachmentAsArtifactButton({ projectId, uri, iconSize = 14 }) {
    if (Platform.OS !== 'web' || !projectId || !uri) return null
    return (
        <TouchableOpacity
            testID="save-attachment-as-artifact"
            onPress={() => require('../ArtifactsView/artifactLinks').openProjectUploads(projectId)}
            accessibilityLabel={translate('Show in artifacts')}
            style={localStyles.button}
        >
            <Icon name="package" size={iconSize} color={colors.Text03} />
        </TouchableOpacity>
    )
}

const localStyles = StyleSheet.create({
    button: {
        marginLeft: 6,
        paddingHorizontal: 2,
        justifyContent: 'center',
        alignItems: 'center',
    },
})
