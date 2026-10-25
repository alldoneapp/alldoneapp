import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { useDispatch, useSelector } from 'react-redux'

import styles, { colors } from '../styles/global'
import Icon from '../Icon'
import { translate, useTranslator } from '../../i18n/TranslationService'
import { setNavigationRoute } from '../../redux/actions'
import { DV_TAB_ROOT_ARTIFACTS } from '../../utils/TabNavigationConstants'
import ProjectHelper, {
    checkIfSelectedAllProjects,
    checkIfSelectedProject,
} from '../SettingsView/ProjectsSettings/ProjectHelper'
import URLsArtifacts, {
    URL_ALL_PROJECTS_ARTIFACTS_ALL,
    URL_ALL_PROJECTS_ARTIFACTS_FOLLOWED,
    URL_PROJECT_ARTIFACTS,
    getArtifactDetailsUrl,
} from '../../URLSystem/Artifacts/URLsArtifacts'
import { ALL_TAB } from '../Feeds/Utils/FeedsConstants'
import ProjectArtifacts from './ProjectArtifacts'
import { getArtifactSection, getSelectedArtifactId, useArtifactsActiveTab } from './artifactsNavigationState'

function AllProjectsArtifacts({ projects }) {
    const [counts, setCounts] = useState({})
    const onLoaded = useCallback((projectId, count) => {
        setCounts(current => (current[projectId] === count ? current : { ...current, [projectId]: count }))
    }, [])

    const allLoaded = projects.every(project => counts[project.id] !== undefined)
    const total = projects.reduce((sum, project) => sum + (counts[project.id] || 0), 0)

    return (
        <View>
            {projects.map(project => (
                <ProjectArtifacts key={project.id} project={project} inAllProjects onLoaded={onLoaded} />
            ))}
            {allLoaded && total === 0 && (
                <View testID="artifacts-all-projects-empty" style={localStyles.emptyState}>
                    <Icon name="package" size={32} color={colors.Text03} />
                    <Text style={localStyles.emptyTitle}>{translate('No artifacts in your projects yet')}</Text>
                    <Text style={localStyles.emptyText}>{translate('Artifacts explanation')}</Text>
                </View>
            )}
        </View>
    )
}

export default function ArtifactsView() {
    useTranslator()
    const dispatch = useDispatch()
    const selectedProjectIndex = useSelector(state => state.selectedProjectIndex)
    const loggedUserProjects = useSelector(state => state.loggedUserProjects)
    const loggedUser = useSelector(state => state.loggedUser)
    const mobile = useSelector(state => state.smallScreenNavigation)
    const isMiddleScreen = useSelector(state => state.isMiddleScreen)
    const [activeTab] = useArtifactsActiveTab()

    const project = loggedUserProjects[selectedProjectIndex]
    const inSelectedProject = checkIfSelectedProject(selectedProjectIndex) && !!project
    const inAllProjects = checkIfSelectedAllProjects(selectedProjectIndex)
    const activeProjects = useMemo(
        () => (inAllProjects ? ProjectHelper.getActiveProjects2(loggedUserProjects, loggedUser) : []),
        [inAllProjects, loggedUserProjects, loggedUser.projectIds, loggedUser.archivedProjectIds]
    )

    useEffect(() => {
        dispatch(setNavigationRoute(DV_TAB_ROOT_ARTIFACTS))
    }, [])

    useEffect(() => {
        if (inSelectedProject) {
            const artifactId = getSelectedArtifactId(project.id)
            if (artifactId)
                URLsArtifacts.push(getArtifactDetailsUrl(getArtifactSection(project.id)), null, project.id, artifactId)
            else URLsArtifacts.push(URL_PROJECT_ARTIFACTS, null, project.id)
        } else if (inAllProjects) {
            URLsArtifacts.push(
                activeTab === ALL_TAB ? URL_ALL_PROJECTS_ARTIFACTS_ALL : URL_ALL_PROJECTS_ARTIFACTS_FOLLOWED
            )
        }
    }, [inSelectedProject, inAllProjects, project?.id])

    return (
        <View
            testID="artifacts-view"
            style={[
                localStyles.container,
                mobile ? localStyles.containerMobile : isMiddleScreen && localStyles.containerTablet,
                inAllProjects && localStyles.containerAllProjects,
            ]}
        >
            {inSelectedProject ? (
                <ProjectArtifacts key={project.id} project={project} />
            ) : (
                <AllProjectsArtifacts projects={activeProjects} />
            )}
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        marginHorizontal: 104,
    },
    containerMobile: {
        marginHorizontal: 16,
    },
    containerTablet: {
        marginHorizontal: 56,
    },
    containerAllProjects: {
        marginTop: 16,
    },
    emptyState: {
        alignItems: 'center',
        paddingVertical: 40,
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
