import React, { useEffect, useMemo, useState } from 'react'
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { useDispatch, useSelector } from 'react-redux'

import styles, { colors } from '../styles/global'
import Icon from '../Icon'
import Button from '../UIControls/Button'
import ProjectSection, { ProjectSectionBody } from '../TaskListView/ProjectSection'
import ProjectHeader from '../TaskListView/Header/ProjectHeader'
import { translate, useTranslator } from '../../i18n/TranslationService'
import { setNavigationRoute } from '../../redux/actions'
import { DV_TAB_ROOT_WIKI } from '../../utils/TabNavigationConstants'
import { checkIfSelectedProject } from '../SettingsView/ProjectsSettings/ProjectHelper'
import URLsWiki, {
    URL_PROJECT_WIKI,
    URL_PROJECT_WIKI_PAGE,
    URL_PROJECT_WIKI_PAGE_CHANGE,
} from '../../URLSystem/Wiki/URLsWiki'
import WikiMarkdown, { getWikiSourceLabel, isOpenableWikiSource } from './WikiMarkdown'
import WikiPageHistory from './WikiPageHistory'
import WikiPageChange from './WikiPageChange'
import WikiCorrectionForm from './WikiCorrectionForm'
import { formatWikiDate, isKnowledgeBaseRunning, useKnowledgeBaseDoc, useKnowledgePages } from './useKnowledgeBase'
import { setWikiSelectedSlug, useWikiSelectedRevision, useWikiSelectedSlug } from './wikiNavigationState'
import { openProjectWikiSettings, openWikiSource } from './wikiLinks'
import { parseKnowledgeSourceKey } from '../../functions/KnowledgeBase/knowledgeBaseModel'

function WikiStatusLine({ knowledgeBase, pendingRebuilds }) {
    const lines = []
    if (isKnowledgeBaseRunning(knowledgeBase)) lines.push(translate('The wiki is being updated right now'))
    else if (knowledgeBase?.lastRunAt) {
        lines.push(translate('Wiki last updated', { date: formatWikiDate(knowledgeBase.lastRunAt) }))
    }
    if (knowledgeBase && knowledgeBase.enabled !== true) lines.push(translate('Wiki paused hint'))
    if (pendingRebuilds > 0) lines.push(translate('Wiki pages being rebuilt', { amount: pendingRebuilds }))
    if (!lines.length) return null
    return (
        <View testID="wiki-status" style={localStyles.statusLine}>
            {lines.map(line => (
                <Text key={line} style={localStyles.statusText}>
                    {line}
                </Text>
            ))}
        </View>
    )
}

function WikiEmptyState({ projectId, knowledgeBase }) {
    const building = knowledgeBase?.enabled === true
    return (
        <View testID={building ? 'wiki-building' : 'wiki-not-set-up'} style={localStyles.emptyState}>
            <Icon name="book-open" size={32} color={colors.Text03} />
            <Text style={localStyles.emptyTitle}>
                {translate(building ? 'The wiki is being built' : 'This project has no wiki yet')}
            </Text>
            <Text style={localStyles.emptyText}>
                {translate(building ? 'Wiki first build hint' : 'Wiki explanation')}
            </Text>
            {!building && (
                <Button
                    title={translate('Set up wiki')}
                    icon="settings"
                    onPress={() => openProjectWikiSettings(projectId)}
                    buttonStyle={localStyles.emptyButton}
                />
            )}
        </View>
    )
}

function WikiIndex({ pages, selectedSlug, onSelect }) {
    return (
        <View testID="wiki-index">
            {pages.map(page => {
                const selected = page.slug === selectedSlug
                return (
                    <TouchableOpacity
                        key={page.slug}
                        testID={`wiki-index-${page.slug}`}
                        style={[localStyles.indexItem, selected && localStyles.indexItemSelected]}
                        onPress={() => onSelect(page.slug)}
                        accessible={false}
                    >
                        <Text style={[localStyles.indexTitle, selected && localStyles.indexTitleSelected]}>
                            {page.title}
                        </Text>
                        {!!page.summary && (
                            <Text style={localStyles.indexSummary} numberOfLines={2}>
                                {page.summary}
                            </Text>
                        )}
                    </TouchableOpacity>
                )
            })}
        </View>
    )
}

function WikiPage({ projectId, page, pageSlugs, onSelectPage, onBack }) {
    const [showHistory, setShowHistory] = useState(false)
    const [correcting, setCorrecting] = useState(false)

    useEffect(() => {
        setShowHistory(false)
        setCorrecting(false)
    }, [page.slug])

    const sources = page.sourceKeys
        .map(key => {
            const parsed = parseKnowledgeSourceKey(key)
            return parsed ? { key, objectType: parsed.type, id: parsed.id, label: '' } : null
        })
        .filter(Boolean)

    return (
        <View testID={`wiki-page-${page.slug}`}>
            {onBack && (
                <TouchableOpacity style={localStyles.backLink} onPress={onBack} accessible={false}>
                    <Icon name="arrow-left" size={16} color={colors.Primary100} />
                    <Text style={localStyles.backLinkText}>{translate('All wiki pages')}</Text>
                </TouchableOpacity>
            )}
            <Text style={localStyles.pageTitle}>{page.title}</Text>
            {!!page.summary && <Text style={localStyles.pageSummary}>{page.summary}</Text>}

            <WikiMarkdown
                body={page.body}
                sourceLabels={page.sourceLabels}
                pageExists={slug => pageSlugs.has(slug)}
                onPressPage={onSelectPage}
                onPressSource={source => openWikiSource(projectId, source)}
            />

            {sources.length > 0 && (
                <View style={localStyles.sources}>
                    <Text style={localStyles.sectionLabel}>{translate('Sources')}</Text>
                    <View style={localStyles.sourceList}>
                        {sources.map(source => (
                            <TouchableOpacity
                                key={source.key}
                                testID={`wiki-page-source-${source.key}`}
                                style={localStyles.sourceItem}
                                disabled={!isOpenableWikiSource(source.objectType)}
                                onPress={() => openWikiSource(projectId, source)}
                                accessible={false}
                            >
                                <Text style={localStyles.sourceItemText} numberOfLines={1}>
                                    {getWikiSourceLabel(source, page.sourceLabels)}
                                </Text>
                            </TouchableOpacity>
                        ))}
                    </View>
                </View>
            )}

            <View style={localStyles.pageFooter}>
                <Text style={localStyles.footerText}>
                    {translate('Wiki page revision', {
                        revision: page.revision,
                        date: formatWikiDate(page.updatedAt),
                    })}
                </Text>
                <View style={localStyles.footerActions}>
                    {!correcting && (
                        <TouchableOpacity
                            testID="wiki-suggest-correction"
                            onPress={() => setCorrecting(true)}
                            accessible={false}
                        >
                            <Text style={localStyles.historyToggle}>{translate('Suggest a correction')}</Text>
                        </TouchableOpacity>
                    )}
                    <TouchableOpacity
                        onPress={() => setShowHistory(!showHistory)}
                        accessible={false}
                        style={localStyles.footerAction}
                    >
                        <Text style={localStyles.historyToggle}>
                            {translate(showHistory ? 'Hide history' : 'Show history')}
                        </Text>
                    </TouchableOpacity>
                </View>
            </View>
            {correcting && (
                <WikiCorrectionForm projectId={projectId} page={page} onClose={() => setCorrecting(false)} />
            )}
            {showHistory && (
                <WikiPageHistory
                    projectId={projectId}
                    slug={page.slug}
                    currentRevision={page.revision}
                    onOpenChange={revision => setWikiSelectedSlug(projectId, page.slug, revision)}
                />
            )}
        </View>
    )
}

export function ProjectWiki({ project }) {
    const mobile = useSelector(state => state.smallScreenNavigation)
    const knowledgeBase = useKnowledgeBaseDoc(project.id)
    const { pages, pendingRebuilds, loaded } = useKnowledgePages(project.id)
    const [selectedSlug, setSelectedSlug] = useWikiSelectedSlug(project.id)
    const selectedRevision = useWikiSelectedRevision(project.id)

    const pageSlugs = useMemo(() => new Set(pages.map(page => page.slug)), [pages])
    const selectedPage = pages.find(page => page.slug === selectedSlug) || null
    // On a wide screen a page is always open; on a phone the index is a screen of its own.
    const shownPage = selectedPage || (!mobile ? pages[0] || null : null)
    // A change is shown for any page, archived or hidden ones included: the Updates feed links to
    // every change, and the page view only knows the pages people may read right now.
    const shownChange = selectedSlug && selectedRevision ? { slug: selectedSlug, revision: selectedRevision } : null

    useEffect(() => {
        if (shownChange) {
            URLsWiki.push(
                URL_PROJECT_WIKI_PAGE_CHANGE,
                null,
                project.id,
                shownChange.slug,
                selectedPage?.title,
                shownChange.revision
            )
        } else if (shownPage) {
            URLsWiki.push(URL_PROJECT_WIKI_PAGE, null, project.id, shownPage.slug, shownPage.title)
        } else {
            URLsWiki.push(URL_PROJECT_WIKI, null, project.id)
        }
    }, [project.id, shownPage?.slug, shownChange?.slug, shownChange?.revision])

    const loading = knowledgeBase === undefined || !loaded
    const changeView = shownChange && (
        <WikiPageChange
            key={`${shownChange.slug}-${shownChange.revision}`}
            projectId={project.id}
            slug={shownChange.slug}
            revision={shownChange.revision}
            pageSlugs={pageSlugs}
            onSelectRevision={revision => setWikiSelectedSlug(project.id, shownChange.slug, revision)}
            onOpenPage={setSelectedSlug}
            onBack={() => setSelectedSlug(null)}
        />
    )

    return (
        <ProjectSection projectId={project.id} projectColor={project.color} selected style={{ marginBottom: 32 }}>
            <ProjectHeader
                projectIndex={project.index}
                projectId={project.id}
                customRight={
                    <Button
                        type={'ghost'}
                        icon={'settings'}
                        onPress={() => openProjectWikiSettings(project.id)}
                        accessibilityLabel={translate('Wiki settings')}
                        buttonStyle={localStyles.settingsButton}
                    />
                }
            />
            <ProjectSectionBody>
                {loading ? (
                    <Text style={localStyles.statusText}>{translate('Loading wiki')}</Text>
                ) : changeView && (mobile || pages.length === 0) ? (
                    changeView
                ) : pages.length === 0 ? (
                    <WikiEmptyState projectId={project.id} knowledgeBase={knowledgeBase} />
                ) : (
                    <>
                        <WikiStatusLine knowledgeBase={knowledgeBase} pendingRebuilds={pendingRebuilds} />
                        {mobile ? (
                            shownPage ? (
                                <WikiPage
                                    projectId={project.id}
                                    page={shownPage}
                                    pageSlugs={pageSlugs}
                                    onSelectPage={setSelectedSlug}
                                    onBack={() => setSelectedSlug(null)}
                                />
                            ) : (
                                <WikiIndex pages={pages} selectedSlug={null} onSelect={setSelectedSlug} />
                            )
                        ) : (
                            <View style={localStyles.columns}>
                                <View style={localStyles.indexColumn}>
                                    <WikiIndex
                                        pages={pages}
                                        selectedSlug={shownChange ? shownChange.slug : shownPage?.slug}
                                        onSelect={setSelectedSlug}
                                    />
                                </View>
                                <View style={localStyles.pageColumn}>
                                    {changeView ||
                                        (shownPage && (
                                            <WikiPage
                                                projectId={project.id}
                                                page={shownPage}
                                                pageSlugs={pageSlugs}
                                                onSelectPage={setSelectedSlug}
                                            />
                                        ))}
                                </View>
                            </View>
                        )}
                    </>
                )}
            </ProjectSectionBody>
        </ProjectSection>
    )
}

export default function WikiView() {
    useTranslator()
    const dispatch = useDispatch()
    const selectedProjectIndex = useSelector(state => state.selectedProjectIndex)
    const project = useSelector(state => state.loggedUserProjects[selectedProjectIndex])
    const mobile = useSelector(state => state.smallScreenNavigation)
    const isMiddleScreen = useSelector(state => state.isMiddleScreen)

    useEffect(() => {
        dispatch(setNavigationRoute(DV_TAB_ROOT_WIKI))
    }, [])

    return (
        <View
            testID="wiki-view"
            style={[
                localStyles.container,
                mobile ? localStyles.containerMobile : isMiddleScreen && localStyles.containerTablet,
            ]}
        >
            {checkIfSelectedProject(selectedProjectIndex) && project ? (
                <ProjectWiki key={project.id} project={project} />
            ) : (
                <View testID="wiki-choose-project" style={localStyles.emptyState}>
                    <Icon name="book-open" size={32} color={colors.Text03} />
                    <Text style={localStyles.emptyText}>{translate('Choose a project to open its wiki')}</Text>
                </View>
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
    settingsButton: {
        marginTop: 16,
    },
    statusLine: {
        marginTop: 12,
        marginBottom: 4,
    },
    statusText: {
        ...styles.caption2,
        color: colors.Text03,
        marginTop: 8,
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
    emptyButton: {
        marginTop: 16,
    },
    columns: {
        flexDirection: 'row',
        marginTop: 12,
    },
    indexColumn: {
        width: 260,
        marginRight: 32,
    },
    pageColumn: {
        flex: 1,
        minWidth: 0,
    },
    indexItem: {
        paddingVertical: 8,
        paddingHorizontal: 12,
        borderRadius: 4,
        marginBottom: 2,
    },
    indexItemSelected: {
        backgroundColor: colors.Grey200,
    },
    indexTitle: {
        ...styles.subtitle2,
        color: colors.Text01,
    },
    indexTitleSelected: {
        color: colors.Primary100,
    },
    indexSummary: {
        ...styles.caption2,
        color: colors.Text03,
        marginTop: 2,
    },
    backLink: {
        flexDirection: 'row',
        alignItems: 'center',
        marginTop: 12,
        marginBottom: 8,
    },
    backLinkText: {
        ...styles.subtitle2,
        color: colors.Primary100,
        marginLeft: 4,
    },
    pageTitle: {
        ...styles.title5,
        color: colors.Text01,
        marginTop: 8,
    },
    pageSummary: {
        ...styles.body2,
        color: colors.Text02,
        marginTop: 4,
        marginBottom: 8,
    },
    sources: {
        marginTop: 16,
        borderTopWidth: 1,
        borderTopColor: colors.Grey300,
        paddingTop: 12,
    },
    sectionLabel: {
        ...styles.overline,
        color: colors.Text03,
        marginBottom: 8,
    },
    sourceList: {
        flexDirection: 'row',
        flexWrap: 'wrap',
    },
    sourceItem: {
        backgroundColor: colors.Grey200,
        borderRadius: 12,
        paddingHorizontal: 8,
        paddingVertical: 2,
        marginRight: 6,
        marginBottom: 6,
        maxWidth: 260,
    },
    sourceItemText: {
        ...styles.body2,
        color: colors.Text02,
    },
    pageFooter: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        flexWrap: 'wrap',
        marginTop: 16,
    },
    footerText: {
        ...styles.caption2,
        color: colors.Text03,
    },
    historyToggle: {
        ...styles.caption2,
        color: colors.Primary100,
    },
    footerActions: {
        flexDirection: 'row',
        flexWrap: 'wrap',
    },
    footerAction: {
        marginLeft: 16,
    },
})
