import React, { useEffect, useRef, useState } from 'react'
import { Platform, StyleSheet, TouchableOpacity } from 'react-native'

import Icon from '../Icon'
import Spinner from '../UIComponents/Spinner'
import { colors } from '../styles/global'
import { translate } from '../../i18n/TranslationService'

// Required on use, like the other actions a chat row can trigger: the backend module reaches the
// store and the Firebase client, which every component rendering an attachment chip would
// otherwise pull in.
const getArtifactsBackend = () => require('../../utils/backends/Artifacts/artifactsFirestore')
const getArtifactLinks = () => require('../ArtifactsView/artifactLinks')

const STATE_ICONS = { idle: 'package', saved: 'check', failed: 'alert-circle' }

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

// The small action inside an attachment chip that copies the file into the project's artifacts
// (decision 3 of ARTIFACTS_PLAN.md: attachments become artifacts only when somebody asks). Once
// saved, the same button opens the new artifact.
export default function SaveAttachmentAsArtifactButton({ projectId, uri, fileName, iconSize = 14 }) {
    const [state, setState] = useState('idle')
    const [artifactId, setArtifactId] = useState(null)
    const mountedRef = useRef(true)

    useEffect(() => {
        mountedRef.current = true
        return () => {
            mountedRef.current = false
        }
    }, [])

    if (Platform.OS !== 'web' || !projectId || !uri) return null

    const onPress = async () => {
        if (state === 'saving') return
        if (state === 'saved' && artifactId) {
            getArtifactLinks().openProjectArtifacts(projectId, artifactId)
            return
        }
        setState('saving')
        try {
            const result = await getArtifactsBackend().saveAttachmentAsArtifact(projectId, uri, fileName)
            if (!mountedRef.current) return
            setArtifactId(result?.artifactId || null)
            setState('saved')
        } catch (error) {
            console.warn('[artifacts] Could not save the attachment as an artifact', { projectId, error })
            if (mountedRef.current) setState('failed')
        }
    }

    const labelKey =
        state === 'saved' ? 'Saved as artifact' : state === 'failed' ? 'Could not save as artifact' : 'Save as artifact'

    return (
        <TouchableOpacity
            testID="save-attachment-as-artifact"
            onPress={onPress}
            disabled={state === 'saving'}
            accessibilityLabel={translate(labelKey)}
            style={localStyles.button}
        >
            {state === 'saving' ? (
                <Spinner containerSize={iconSize} spinnerSize={iconSize} />
            ) : (
                <Icon
                    name={STATE_ICONS[state]}
                    size={iconSize}
                    color={
                        state === 'saved'
                            ? colors.UtilityGreen200
                            : state === 'failed'
                              ? colors.UtilityRed200
                              : colors.Text03
                    }
                />
            )}
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
