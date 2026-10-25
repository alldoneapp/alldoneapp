import React, { useCallback, useEffect, useRef, useState } from 'react'
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native'

import styles, { colors } from '../styles/global'
import Icon from '../Icon'
import Button from '../UIControls/Button'
import ProjectSection, { ProjectSectionBody } from '../TaskListView/ProjectSection'
import ProjectHeader from '../TaskListView/Header/ProjectHeader'
import { translate } from '../../i18n/TranslationService'
import URLsArtifacts, { URL_ARTIFACT_DETAILS, URL_PROJECT_ARTIFACTS } from '../../URLSystem/Artifacts/URLsArtifacts'
import { ALL_TAB } from '../Feeds/Utils/FeedsConstants'
import ArtifactRow from './ArtifactRow'
import ArtifactDetail from './ArtifactDetail'
import { ArtifactDropZone, ArtifactFileInput, ArtifactUploadStatus, useArtifactUploader } from './ArtifactUpload'
import { useArtifactsActiveTab, useSelectedArtifactId } from './artifactsNavigationState'
import { openProjectArtifacts } from './artifactLinks'
import { useProjectArtifacts } from './useArtifacts'
import { filterArtifactsByKindGroup, getPresentArtifactKindGroups } from './artifactPresentation'

// Filter chips over the list, offered only when there is more than one kind to choose between.
function KindFilter({ groups, active, onChange }) {
    if (groups.length === 0) return null
    const options = [{ key: null, labelKey: 'All' }, ...groups]
    return (
        <View testID="artifacts-kind-filter" style={localStyles.chips} accessibilityRole="tablist">
            {options.map(option => {
                const selected = option.key === active
                return (
                    <TouchableOpacity
                        key={option.key || 'all'}
                        testID={`artifacts-kind-${option.key || 'all'}`}
                        accessibilityRole="tab"
                        accessibilityState={{ selected }}
                        onPress={() => onChange(option.key)}
                        style={[localStyles.chip, selected && localStyles.chipSelected]}
                        accessible={false}
                    >
                        <Text style={[localStyles.chipText, selected && localStyles.chipTextSelected]}>
                            {translate(option.labelKey)}
                        </Text>
                    </TouchableOpacity>
                )
            })}
        </View>
    )
}

function EmptyArtifacts({ followedOnly }) {
    return (
        <View testID="artifacts-empty" style={localStyles.emptyState}>
            <Icon name="package" size={32} color={colors.Text03} />
            <Text style={localStyles.emptyTitle}>
                {translate(followedOnly ? 'No followed artifacts yet' : 'No artifacts yet')}
            </Text>
            <Text style={localStyles.emptyText}>{translate('Artifacts explanation')}</Text>
        </View>
    )
}

// One project's artifacts. In a single project it is the whole view and opens an artifact in place;
// in All projects it is one section among many, hides itself while empty, and opening an artifact
// switches to that project.
export default function ProjectArtifacts({ project, inAllProjects = false, onLoaded }) {
    const [activeTab] = useArtifactsActiveTab()
    const followedOnly = activeTab !== ALL_TAB
    const { artifacts, loaded } = useProjectArtifacts(project.id, followedOnly)
    const [selectedArtifactId, setSelectedArtifactId] = useSelectedArtifactId(project.id)
    const openArtifactId = inAllProjects ? null : selectedArtifactId
    const fileInput = useRef(null)
    const [kindGroup, setKindGroup] = useState(null)
    const kindGroups = inAllProjects ? [] : getPresentArtifactKindGroups(artifacts)
    // A filter whose kind is gone (the last such artifact was deleted) is no filter.
    const activeKindGroup = kindGroups.some(group => group.key === kindGroup) ? kindGroup : null
    const shownArtifacts = filterArtifactsByKindGroup(artifacts, activeKindGroup)

    const onUploaded = useCallback(
        result => {
            if (!inAllProjects && result?.created) {
                // Opened like any other artifact, so a reload or a copied address lands on it too.
                setSelectedArtifactId(result.artifactId)
                URLsArtifacts.push(URL_ARTIFACT_DETAILS, null, project.id, result.artifactId)
            }
        },
        [inAllProjects]
    )
    const { uploading, error, uploadFiles } = useArtifactUploader({ projectId: project.id, onUploaded })

    useEffect(() => {
        if (loaded && onLoaded) onLoaded(project.id, artifacts.length)
    }, [loaded, artifacts.length])

    const openArtifact = artifact => {
        if (inAllProjects) openProjectArtifacts(project.id, artifact.id)
        else {
            setSelectedArtifactId(artifact.id)
            URLsArtifacts.push(URL_ARTIFACT_DETAILS, null, project.id, artifact.id, artifact.title)
        }
    }

    const closeArtifact = () => {
        setSelectedArtifactId(null)
        URLsArtifacts.push(URL_PROJECT_ARTIFACTS, null, project.id)
    }

    if (inAllProjects && (!loaded || artifacts.length === 0)) return null

    return (
        <ProjectSection projectId={project.id} projectColor={project.color} selected style={localStyles.section}>
            <ProjectHeader
                projectIndex={project.index}
                projectId={project.id}
                showRootSectionNavigation={!inAllProjects}
                customRight={
                    !openArtifactId && (
                        <Button
                            type={'ghost'}
                            icon={'plus'}
                            onPress={() => fileInput.current?.open()}
                            disabled={uploading}
                            accessibilityLabel={translate('Add artifact')}
                            buttonStyle={localStyles.addButton}
                        />
                    )
                }
            />
            <ProjectSectionBody>
                {openArtifactId ? (
                    <ArtifactDetail projectId={project.id} artifactId={openArtifactId} onBack={closeArtifact} />
                ) : (
                    <ArtifactDropZone
                        onFiles={uploadFiles}
                        disabled={uploading}
                        testID={`artifacts-drop-${project.id}`}
                    >
                        <ArtifactFileInput ref={fileInput} onFiles={uploadFiles} />
                        <ArtifactUploadStatus uploading={uploading} error={error} />
                        {!loaded ? (
                            <Text style={localStyles.status}>{translate('Loading artifacts')}</Text>
                        ) : artifacts.length === 0 ? (
                            <EmptyArtifacts followedOnly={followedOnly} />
                        ) : (
                            <View testID={`artifacts-list-${project.id}`} style={localStyles.list}>
                                <KindFilter groups={kindGroups} active={activeKindGroup} onChange={setKindGroup} />
                                {shownArtifacts.map(artifact => (
                                    <ArtifactRow key={artifact.id} artifact={artifact} onPress={openArtifact} />
                                ))}
                            </View>
                        )}
                        {!inAllProjects && loaded && (
                            <Button
                                type="ghost"
                                icon="upload"
                                title={translate('Add artifact')}
                                onPress={() => fileInput.current?.open()}
                                disabled={uploading}
                                buttonStyle={localStyles.addInlineButton}
                            />
                        )}
                    </ArtifactDropZone>
                )}
            </ProjectSectionBody>
        </ProjectSection>
    )
}

const localStyles = StyleSheet.create({
    section: {
        marginBottom: 32,
    },
    addButton: {
        marginTop: 16,
    },
    addInlineButton: {
        marginTop: 8,
        marginBottom: 8,
        alignSelf: 'flex-start',
    },
    list: {
        marginTop: 8,
    },
    chips: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        marginBottom: 4,
    },
    chip: {
        paddingHorizontal: 10,
        paddingVertical: 4,
        borderRadius: 14,
        borderWidth: 1,
        borderColor: colors.Grey300,
        marginRight: 6,
        marginBottom: 6,
    },
    chipSelected: {
        backgroundColor: colors.Primary100,
        borderColor: colors.Primary100,
    },
    chipText: {
        ...styles.caption1,
        color: colors.Text02,
    },
    chipTextSelected: {
        color: '#FFFFFF',
    },
    status: {
        ...styles.caption2,
        color: colors.Text03,
        marginTop: 8,
    },
    emptyState: {
        alignItems: 'center',
        paddingVertical: 32,
        paddingHorizontal: 16,
    },
    emptyTitle: {
        ...styles.title7,
        color: colors.Text01,
        marginTop: 12,
        textAlign: 'center',
    },
    emptyText: {
        ...styles.body2,
        color: colors.Text02,
        marginTop: 8,
        maxWidth: 480,
        textAlign: 'center',
    },
})
