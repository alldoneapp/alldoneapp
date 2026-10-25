import React, { useEffect, useRef } from 'react'
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native'

import Icon from '../../../Icon'
import styles, { colors } from '../../../styles/global'
import ProjectHeader from '../Common/ProjectHeader'
import { goToObjectDetailView } from '../../searchFunctions'
import ProjectHelper from '../../../SettingsView/ProjectsSettings/ProjectHelper'
import { getArtifactKindIcon } from '../../../ArtifactsView/artifactPresentation'
import { FEED_PUBLIC_FOR_ALL } from '../../../Feeds/Utils/FeedsConstants'

const isPrivateArtifact = artifact =>
    artifact.isPrivate === true ||
    (Array.isArray(artifact.isPublicFor) && !artifact.isPublicFor.includes(FEED_PUBLIC_FOR_ALL))

export default function ArtifactByProject({ project, artifacts, activeItemIndex, activeItemRef }) {
    const rowRefs = useRef({})

    useEffect(() => {
        const active = artifacts[activeItemIndex]
        if (activeItemRef && active) activeItemRef.current = rowRefs.current[active.id]
    }, [activeItemIndex])

    const open = artifact => {
        const path = `/projects/${project.id}/artifacts/${artifact.id}`
        const { inactive, projectType } = ProjectHelper.checkIfProjectIdBelongsToInactiveProject(project.id)
        if (inactive) ProjectHelper.navigateToInactiveProject(projectType, path)
        else goToObjectDetailView(project.id, artifact.id, 'artifacts', 'artifact')
    }

    if (!artifacts || artifacts.length === 0) return null

    return (
        <View>
            <ProjectHeader project={project} amount={artifacts.length} />
            <View style={localStyles.list}>
                {artifacts.map((artifact, index) => (
                    <TouchableOpacity
                        key={artifact.id}
                        testID={`search-artifact-${artifact.id}`}
                        ref={ref => (rowRefs.current[artifact.id] = ref)}
                        style={[localStyles.row, index === activeItemIndex && localStyles.highlighted]}
                        onPress={() => open(artifact)}
                    >
                        <Icon name={getArtifactKindIcon(artifact.kind)} size={24} color="#ffffff" />
                        <View style={localStyles.texts}>
                            <Text style={localStyles.title} numberOfLines={1}>
                                {artifact.title}
                            </Text>
                            {!!artifact.description && (
                                <Text style={localStyles.description} numberOfLines={1}>
                                    {artifact.description}
                                </Text>
                            )}
                        </View>
                        {isPrivateArtifact(artifact) && <Icon name="lock" size={16} color={colors.Text03} />}
                    </TouchableOpacity>
                ))}
            </View>
        </View>
    )
}

const localStyles = StyleSheet.create({
    list: {
        marginHorizontal: -8,
        paddingHorizontal: 16,
    },
    row: {
        flexDirection: 'row',
        alignItems: 'flex-start',
        padding: 8,
    },
    // Same keyboard highlight as the other result tabs (MentionsItems).
    highlighted: {
        backgroundColor: colors.Primary300,
        borderRadius: 4,
        borderWidth: 2,
        borderColor: colors.UtilityBlue150,
        borderStyle: 'dashed',
    },
    texts: {
        flex: 1,
        minWidth: 0,
        marginHorizontal: 8,
    },
    title: {
        ...styles.body1,
        color: '#ffffff',
    },
    description: {
        ...styles.caption2,
        color: colors.Text03,
    },
})
