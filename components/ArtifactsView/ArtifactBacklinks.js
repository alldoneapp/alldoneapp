import React, { useEffect, useState } from 'react'
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native'

import Icon from '../Icon'
import styles, { colors } from '../styles/global'
import { translate } from '../../i18n/TranslationService'
import { watchArtifactBacklinks } from '../../utils/backends/Artifacts/artifactsFirestore'
import { cleanTextMetaData } from '../../functions/Utils/parseTextUtils'

const OBJECT_PATHS = { task: 'tasks/{id}/properties', note: 'notes/{id}/editor' }

export function getBacklinkPath(projectId, link) {
    return `/projects/${projectId}/${OBJECT_PATHS[link.type].replace('{id}', link.id)}`
}

// The tasks and notes that link to this artifact in their text: where it is being talked about.
// Renders nothing until something links here, so a fresh artifact keeps its compact layout.
export default function ArtifactBacklinks({ projectId, artifactId }) {
    const [links, setLinks] = useState([])

    useEffect(() => {
        setLinks([])
        return watchArtifactBacklinks(projectId, artifactId, setLinks, () => setLinks([]))
    }, [projectId, artifactId])

    if (links.length === 0) return null

    const open = link => {
        // Required on use: the URL system reaches most of the app.
        const URLTrigger = require('../../URLSystem/URLTrigger').default
        const NavigationService = require('../../utils/NavigationService').default
        URLTrigger.processUrl(NavigationService, getBacklinkPath(projectId, link))
    }

    return (
        <View testID="artifact-backlinks" style={localStyles.container}>
            <Text style={localStyles.title}>{translate('Linked from')}</Text>
            {links.map(link => (
                <TouchableOpacity
                    key={`${link.type}-${link.id}`}
                    testID={`artifact-backlink-${link.type}-${link.id}`}
                    style={localStyles.row}
                    onPress={() => open(link)}
                    accessibilityRole="link"
                >
                    <Icon name={link.type === 'task' ? 'check-square' : 'file-text'} size={16} color={colors.Text03} />
                    <Text style={[localStyles.rowText, link.done && localStyles.done]} numberOfLines={1}>
                        {cleanTextMetaData(link.title) || translate(link.type === 'task' ? 'Task' : 'Note')}
                    </Text>
                </TouchableOpacity>
            ))}
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        marginTop: 16,
    },
    title: {
        ...styles.subtitle2,
        color: colors.Text02,
        marginBottom: 4,
    },
    row: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingVertical: 6,
    },
    rowText: {
        ...styles.body2,
        color: colors.Text01,
        marginLeft: 8,
        flex: 1,
    },
    done: {
        color: colors.Text03,
    },
})
