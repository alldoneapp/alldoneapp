import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native'

import styles, { colors } from '../styles/global'
import Icon from '../Icon'
import ProjectSection, { ProjectSectionBody } from '../TaskListView/ProjectSection'
import ProjectHeader from '../TaskListView/Header/ProjectHeader'
import { translate } from '../../i18n/TranslationService'
import WikiIndex from './WikiIndex'
import { useRecentKnowledgePages } from './useKnowledgeBase'
import { openProjectWiki } from './wikiLinks'

// How many of a project's newest pages All projects shows; the rest is one press away.
export const ALL_PROJECTS_WIKI_PREVIEW = 5

// Newest page first, like the Notes and Artifacts lists; equal dates keep the user's project order.
export function sortProjectsByNewestWikiPage(projects, newestByProjectId = {}) {
    return projects
        .map((project, index) => ({ project, index, newest: Number(newestByProjectId[project.id]) || 0 }))
        .sort((left, right) => right.newest - left.newest || left.index - right.index)
        .map(entry => entry.project)
}

function ProjectWikiPreview({ project, onLoaded }) {
    const { pages, loaded } = useRecentKnowledgePages(project.id, ALL_PROJECTS_WIKI_PREVIEW)

    useEffect(() => {
        if (loaded) onLoaded(project.id, pages.length, pages[0]?.updatedAt || 0)
    }, [loaded, pages])

    // A project without wiki pages takes no room here; its own wiki explains how to set one up.
    if (!loaded || pages.length === 0) return null

    return (
        <ProjectSection projectId={project.id} projectColor={project.color} selected style={localStyles.section}>
            <ProjectHeader projectIndex={project.index} projectId={project.id} />
            <ProjectSectionBody>
                <WikiIndex
                    pages={pages}
                    onSelect={slug => openProjectWiki(project.id, slug)}
                    testIdPrefix={`wiki-all-projects-${project.id}`}
                />
                <TouchableOpacity
                    testID={`wiki-all-projects-open-${project.id}`}
                    style={localStyles.allPages}
                    onPress={() => openProjectWiki(project.id)}
                    accessibilityRole="link"
                >
                    <Text style={localStyles.allPagesText}>{translate('All wiki pages')}</Text>
                    <Icon name="chevron-right" size={16} color={colors.Primary100} />
                </TouchableOpacity>
            </ProjectSectionBody>
        </ProjectSection>
    )
}

/**
 * AT-3121: the wiki of All projects. Each project that has a wiki shows its line and its newest pages;
 * a page opens in its project's wiki, as does "All wiki pages". Projects are ordered by their newest
 * page, and keys are stable, so a reorder moves the sections instead of remounting their listeners.
 */
export default function AllProjectsWiki({ projects }) {
    const [counts, setCounts] = useState({})
    const [newestDates, setNewestDates] = useState({})
    const onLoaded = useCallback((projectId, count, newestDate) => {
        setCounts(current => (current[projectId] === count ? current : { ...current, [projectId]: count }))
        setNewestDates(current =>
            current[projectId] === newestDate ? current : { ...current, [projectId]: newestDate }
        )
    }, [])

    const allLoaded = projects.every(project => counts[project.id] !== undefined)
    const total = projects.reduce((sum, project) => sum + (counts[project.id] || 0), 0)
    const orderedProjects = useMemo(() => sortProjectsByNewestWikiPage(projects, newestDates), [projects, newestDates])

    return (
        <View testID="wiki-all-projects">
            {orderedProjects.map(project => (
                <ProjectWikiPreview key={project.id} project={project} onLoaded={onLoaded} />
            ))}
            {!allLoaded && total === 0 && (
                <Text testID="wiki-all-projects-loading" style={localStyles.status}>
                    {translate('Loading wiki')}
                </Text>
            )}
            {allLoaded && total === 0 && (
                <View testID="wiki-all-projects-empty" style={localStyles.emptyState}>
                    <Icon name="book-open" size={32} color={colors.Text03} />
                    <Text style={localStyles.emptyTitle}>{translate('No wiki pages in your projects yet')}</Text>
                    <Text style={localStyles.emptyText}>{translate('Wiki explanation')}</Text>
                </View>
            )}
        </View>
    )
}

const localStyles = StyleSheet.create({
    section: {
        marginBottom: 32,
    },
    allPages: {
        flexDirection: 'row',
        alignItems: 'center',
        alignSelf: 'flex-start',
        paddingVertical: 8,
        paddingHorizontal: 12,
        marginTop: 4,
    },
    allPagesText: {
        ...styles.subtitle2,
        color: colors.Primary100,
        marginRight: 4,
    },
    status: {
        ...styles.caption2,
        color: colors.Text03,
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
        textAlign: 'center',
        maxWidth: 520,
    },
})
