import React, { useEffect, useState } from 'react'
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { useSelector } from 'react-redux'

import Icon from '../Icon'
import styles, { colors } from '../styles/global'
import { translate } from '../../i18n/TranslationService'
import { watchArtifact } from '../../utils/backends/Artifacts/artifactsFirestore'
import ArtifactPreview from './ArtifactPreview'
import { showArtifactPreviewAsLink } from './artifactNoteEmbed'

export const ARTIFACT_EMBED_PREVIEW_HEIGHT = 320

// An artifact shown inside a note: its title, a live preview at a fixed height, and a way to open
// it. The preview is read with the viewer's own access, like everything else in the note: someone
// who may read the note but not the artifact sees that it is not available, never its content.
export default function ArtifactEmbedCard({ projectId, artifactId, title, url, editorId, embedNode }) {
    const readOnly = useSelector(
        state => state.loggedUser.isAnonymous || (state.activeNoteId !== '' && state.activeNoteIsReadOnly)
    )
    const [artifact, setArtifact] = useState(undefined)

    useEffect(() => {
        setArtifact(undefined)
        return watchArtifact(projectId, artifactId, setArtifact)
    }, [projectId, artifactId])

    const open = () => {
        // Required on use: the URL system reaches most of the app, and this renders inside a blot.
        const URLTrigger = require('../../URLSystem/URLTrigger').default
        const NavigationService = require('../../utils/NavigationService').default
        URLTrigger.processUrl(NavigationService, `/projects/${projectId}/artifacts/${artifactId}`)
    }

    const shownTitle = artifact?.title || title || translate('Artifact')

    return (
        <View testID={`artifact-embed-${artifactId}`} style={localStyles.card}>
            <View style={localStyles.header}>
                <Icon name="layers" size={18} color={colors.Text03} />
                <Text style={localStyles.title} numberOfLines={1}>
                    {shownTitle}
                </Text>
                {!readOnly && (
                    <TouchableOpacity
                        testID="artifact-embed-as-link"
                        onPress={() => showArtifactPreviewAsLink(embedNode, { url, projectId, editorId })}
                        style={localStyles.action}
                        accessibilityLabel={translate('Show as link')}
                    >
                        <Icon name="link" size={16} color={colors.Text03} />
                    </TouchableOpacity>
                )}
                <TouchableOpacity testID="artifact-embed-open" onPress={open} style={localStyles.action}>
                    <Text style={localStyles.link}>{translate('Open')}</Text>
                </TouchableOpacity>
            </View>
            {artifact === undefined ? (
                <Text style={localStyles.message}>{translate('Loading artifact')}</Text>
            ) : artifact === null ? (
                <Text testID="artifact-embed-missing" style={localStyles.message}>
                    {translate('Artifact not available')}
                </Text>
            ) : (
                <View style={localStyles.preview}>
                    <ArtifactPreview projectId={projectId} artifact={artifact} height={ARTIFACT_EMBED_PREVIEW_HEIGHT} />
                </View>
            )}
        </View>
    )
}

const localStyles = StyleSheet.create({
    card: {
        width: '100%',
        maxWidth: 640,
        borderWidth: 1,
        borderColor: colors.Grey300,
        borderRadius: 8,
        backgroundColor: '#FFFFFF',
        padding: 8,
        marginVertical: 4,
    },
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        marginBottom: 8,
    },
    title: {
        ...styles.subtitle2,
        color: colors.Text01,
        marginLeft: 8,
        flex: 1,
    },
    action: {
        marginLeft: 12,
        paddingVertical: 2,
    },
    link: {
        ...styles.subtitle2,
        color: colors.Primary100,
    },
    preview: {
        maxHeight: ARTIFACT_EMBED_PREVIEW_HEIGHT + 24,
        overflow: 'hidden',
    },
    message: {
        ...styles.body2,
        color: colors.Text03,
        paddingVertical: 24,
        textAlign: 'center',
    },
})
