import React, { useEffect, useState } from 'react'
import { StyleSheet, Text, View } from 'react-native'

import styles, { colors } from '../styles/global'
import { translate } from '../../i18n/TranslationService'
import { watchObjectArtifacts } from '../../utils/backends/Artifacts/artifactsFirestore'
import { openProjectArtifacts } from './artifactLinks'

// What an object's thread produced: the artifacts an assistant or a VM run made while working on
// this task or goal (decision "artifacts as deliverables", ARTIFACTS_PLAN.md §7). The next reviewer
// reviews the result itself rather than a chat message about it. Renders nothing until there is
// something to show, so an ordinary task looks exactly as before.
export default function ObjectArtifacts({ projectId, objectType, objectId }) {
    const [artifacts, setArtifacts] = useState([])

    useEffect(() => {
        setArtifacts([])
        return watchObjectArtifacts(projectId, objectType, objectId, setArtifacts, () => setArtifacts([]))
    }, [projectId, objectType, objectId])

    if (artifacts.length === 0) return null

    // Required on use: the row reaches the date-format helpers, which reach much of the app, and
    // every task's properties render this component.
    const ArtifactRow = require('./ArtifactRow').default

    return (
        <View testID={`object-artifacts-${objectId}`} style={localStyles.container}>
            <Text style={localStyles.title}>{translate('Results')}</Text>
            <Text style={localStyles.hint}>{translate('Object artifacts hint')}</Text>
            {artifacts.map(artifact => (
                <ArtifactRow
                    key={artifact.id}
                    artifact={artifact}
                    projectId={projectId}
                    onPress={() => openProjectArtifacts(projectId, artifact.id)}
                />
            ))}
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        marginTop: 16,
        marginBottom: 8,
        paddingHorizontal: 8,
    },
    title: {
        ...styles.subtitle1,
        color: colors.Text01,
    },
    hint: {
        ...styles.caption2,
        color: colors.Text03,
        marginTop: 2,
        marginBottom: 4,
    },
})
