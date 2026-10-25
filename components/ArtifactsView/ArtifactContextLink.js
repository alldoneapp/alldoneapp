import React from 'react'
import { StyleSheet, Text, TouchableOpacity } from 'react-native'

import styles, { colors } from '../styles/global'
import Icon from '../Icon'
import { translate } from '../../i18n/TranslationService'
import { getContextIcon, useArtifactContext } from './artifactContext'

// "In Meeting notes", "Created in Prepare the offsite": the way from an artifact to where it was
// made, the note a screenshot was uploaded into or the thread an assistant created it in. Renders
// nothing for an artifact with no context the viewer may open. `compact` is the line in a list row.
export default function ArtifactContextLink({ projectId, artifact, onOpen, compact = false, testID }) {
    const context = useArtifactContext(projectId, artifact)
    if (!context) return null
    return (
        <TouchableOpacity
            testID={testID}
            onPress={() => onOpen(context.source)}
            accessibilityRole="link"
            accessibilityLabel={`${translate('Open in context')}: ${context.label}`}
            style={compact ? localStyles.compact : localStyles.full}
        >
            <Icon name={getContextIcon(context.source.type)} size={compact ? 12 : 16} color={colors.Primary100} />
            <Text style={compact ? localStyles.compactText : localStyles.fullText} numberOfLines={1}>
                {context.label}
            </Text>
        </TouchableOpacity>
    )
}

const localStyles = StyleSheet.create({
    // Only the label is the target, so a tap beside it still opens the row's own file.
    compact: {
        flexDirection: 'row',
        alignItems: 'center',
        alignSelf: 'flex-start',
        maxWidth: '100%',
        marginTop: 2,
        paddingVertical: 2,
        paddingRight: 4,
        borderRadius: 4,
    },
    compactText: {
        ...styles.caption2,
        color: colors.Primary100,
        marginLeft: 4,
        flexShrink: 1,
    },
    full: {
        flexDirection: 'row',
        alignItems: 'center',
        alignSelf: 'flex-start',
        maxWidth: '100%',
        marginTop: 12,
        paddingVertical: 4,
        borderRadius: 4,
    },
    fullText: {
        ...styles.body2,
        color: colors.Primary100,
        marginLeft: 8,
        flexShrink: 1,
    },
})
