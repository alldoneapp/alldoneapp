import React, { useEffect, useState } from 'react'
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native'

import styles, { colors } from '../styles/global'
import Icon from '../Icon'
import { translate } from '../../i18n/TranslationService'
import { getKnowledgePageChange } from '../../utils/backends/KnowledgeBase/knowledgeBaseFirestore'
import { isKnowledgePageVisible, parseKnowledgeSourceKey } from '../../functions/KnowledgeBase/knowledgeBaseModel'
import {
    WIKI_CHANGE_ARCHIVED,
    WIKI_CHANGE_CREATED,
    getWikiChangeAuthorId,
} from '../../functions/KnowledgeBase/knowledgeWikiFeedModel'
import WikiDiffView from './WikiDiffView'
import WikiMarkdown, { getWikiSourceLabel } from './WikiMarkdown'
import { diffSourceKeys, formatWikiTextForDiff, resolveWikiChange } from './wikiDiff'
import { formatWikiDate } from './useKnowledgeBase'
import { describeWikiChange } from './wikiChangeText'

function sourceNode(key) {
    const parsed = parseKnowledgeSourceKey(key)
    return parsed ? { key, objectType: parsed.type, label: '' } : null
}

export function Notice({ text, testID }) {
    return (
        <View testID={testID} style={localStyles.notice}>
            <Icon name="info" size={16} color={colors.Text03} />
            <Text style={localStyles.noticeText}>{text}</Text>
        </View>
    )
}

function SectionDiff({ label, before, after, testID }) {
    return (
        <View style={localStyles.section}>
            <Text style={localStyles.sectionLabel}>{label}</Text>
            <WikiDiffView before={before} after={after} testID={testID} />
        </View>
    )
}

function SourceChanges({ before, after, sourceLabels }) {
    const { added, removed } = diffSourceKeys(before, after)
    if (!added.length && !removed.length) return null
    const list = keys =>
        keys
            .map(sourceNode)
            .filter(Boolean)
            .map(node => getWikiSourceLabel(node, sourceLabels))
            .join(', ')
    return (
        <View testID="wiki-change-sources" style={localStyles.section}>
            <Text style={localStyles.sectionLabel}>{translate('Sources')}</Text>
            {added.length > 0 && (
                <Text style={localStyles.meta}>{`+ ${translate('Sources added')}: ${list(added)}`}</Text>
            )}
            {removed.length > 0 && (
                <Text style={localStyles.meta}>{`− ${translate('Sources removed')}: ${list(removed)}`}</Text>
            )}
        </View>
    )
}

// Shared with the recent-changes view (WikiPageRecentChanges), which passes its own wording for a
// comparison whose starting text is gone.
export function ChangeContent({ change, sourceLabels, pageSlugs, baseUnavailableText }) {
    const labelFor = source => getWikiSourceLabel(sourceNode(`${source.type}:${source.id}`) || {}, sourceLabels)
    const format = text => formatWikiTextForDiff(text, labelFor)
    const { kind, before, after } = change

    if (change.status === 'baseUnavailable') {
        if (kind === WIKI_CHANGE_ARCHIVED) {
            return <Notice testID="wiki-change-base-unavailable" text={translate('Wiki archived text unavailable')} />
        }
        return (
            <>
                <Notice
                    testID="wiki-change-base-unavailable"
                    text={baseUnavailableText || translate('Wiki previous text unavailable')}
                />
                <WikiMarkdown body={after.body} sourceLabels={sourceLabels} pageExists={slug => pageSlugs.has(slug)} />
            </>
        )
    }

    const compareMeta = kind !== WIKI_CHANGE_CREATED && kind !== WIKI_CHANGE_ARCHIVED
    return (
        <>
            {compareMeta && before.title !== after.title && (
                <SectionDiff
                    label={translate('Wiki change section title')}
                    before={before.title}
                    after={after.title}
                    testID="wiki-diff-title"
                />
            )}
            {compareMeta && before.summary !== after.summary && (
                <SectionDiff
                    label={translate('Wiki change section summary')}
                    before={before.summary}
                    after={after.summary}
                    testID="wiki-diff-summary"
                />
            )}
            <SectionDiff
                label={translate('Wiki change section text')}
                before={format(before.body)}
                after={format(after.body)}
                testID="wiki-diff-body"
            />
            {compareMeta && (
                <SourceChanges before={before.sourceKeys} after={after.sourceKeys} sourceLabels={sourceLabels} />
            )}
        </>
    )
}

/**
 * What one revision of a wiki page changed, against the revision before it. Read from the revisions
 * themselves, so a revision whose text the wiki removed (a source turned private or was deleted)
 * shows that it was removed and nothing more. Works for pages that are archived or waiting for a
 * rebuild too, which the page view cannot show.
 */
export default function WikiPageChange({
    projectId,
    slug,
    revision,
    pageSlugs = new Set(),
    onSelectRevision,
    onOpenPage,
    onBack,
}) {
    const [state, setState] = useState({ status: 'loading' })

    useEffect(() => {
        let cancelled = false
        setState({ status: 'loading' })
        getKnowledgePageChange(projectId, slug, revision)
            .then(result => !cancelled && setState({ status: 'loaded', ...(result || {}) }))
            .catch(() => !cancelled && setState({ status: 'failed' }))
        return () => {
            cancelled = true
        }
    }, [projectId, slug, revision])

    const page = state.page || null
    const pageVisible = isKnowledgePageVisible(page)
    const backLink = (
        <TouchableOpacity
            testID="wiki-change-back"
            style={localStyles.backLink}
            onPress={() => (pageVisible ? onOpenPage(slug) : onBack())}
            accessible={false}
        >
            <Icon name="arrow-left" size={16} color={colors.Primary100} />
            <Text style={localStyles.backLinkText} numberOfLines={1}>
                {pageVisible ? page.title : translate('All wiki pages')}
            </Text>
        </TouchableOpacity>
    )

    if (state.status === 'loading') {
        return (
            <View testID="wiki-change-loading">
                {backLink}
                <Text style={localStyles.meta}>{translate('Loading change')}</Text>
            </View>
        )
    }
    const change = state.status === 'loaded' ? resolveWikiChange(state.revision, state.previous) : null
    if (!change || change.status === 'missing') {
        return (
            <View testID="wiki-change-unavailable">
                {backLink}
                <Text style={localStyles.meta}>
                    {translate(state.status === 'failed' ? 'Could not load the change' : 'Wiki change not found')}
                </Text>
            </View>
        )
    }

    const stored = state.revision
    const title = stored.title || state.previous?.title || page?.title || slug
    const actorName = getWikiChangeAuthorId(stored)
        ? stored.author?.name || translate('A project member')
        : translate('The wiki')
    const newestRevision = Number(page?.revision) || revision
    const sourceLabels = page?.sourceLabels || {}

    return (
        <View testID={`wiki-change-${slug}-${revision}`}>
            {backLink}
            <Text style={localStyles.pageTitle}>{title}</Text>
            <Text style={localStyles.meta}>
                {`${translate('Revision')} ${revision} · ${formatWikiDate(stored.createdAt)}`}
            </Text>
            <Text testID="wiki-change-description" style={localStyles.description}>
                {describeWikiChange(change.kind, actorName, title)}
            </Text>
            {!!stored.reason && <Text style={localStyles.reason}>{stored.reason}</Text>}

            {change.status === 'redacted' ? (
                <Notice testID="wiki-change-redacted" text={translate('Revision redacted')} />
            ) : (
                <ChangeContent change={change} sourceLabels={sourceLabels} pageSlugs={pageSlugs} />
            )}

            <View style={localStyles.navigation}>
                {revision > 1 && (
                    <TouchableOpacity
                        testID="wiki-change-older"
                        onPress={() => onSelectRevision(revision - 1)}
                        accessible={false}
                        style={localStyles.navigationAction}
                    >
                        <Text style={localStyles.action}>{translate('Older change')}</Text>
                    </TouchableOpacity>
                )}
                {revision < newestRevision && (
                    <TouchableOpacity
                        testID="wiki-change-newer"
                        onPress={() => onSelectRevision(revision + 1)}
                        accessible={false}
                        style={localStyles.navigationAction}
                    >
                        <Text style={localStyles.action}>{translate('Newer change')}</Text>
                    </TouchableOpacity>
                )}
                {pageVisible && (
                    <TouchableOpacity
                        testID="wiki-change-open-page"
                        onPress={() => onOpenPage(slug)}
                        accessible={false}
                        style={localStyles.navigationAction}
                    >
                        <Text style={localStyles.action}>{translate('Open page')}</Text>
                    </TouchableOpacity>
                )}
            </View>
        </View>
    )
}

const localStyles = StyleSheet.create({
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
        flexShrink: 1,
    },
    pageTitle: {
        ...styles.title5,
        color: colors.Text01,
        marginTop: 8,
    },
    meta: {
        ...styles.caption2,
        color: colors.Text03,
        marginTop: 4,
    },
    description: {
        ...styles.body2,
        color: colors.Text02,
        marginTop: 8,
    },
    reason: {
        ...styles.body2,
        color: colors.Text03,
        fontStyle: 'italic',
        marginTop: 4,
    },
    notice: {
        flexDirection: 'row',
        alignItems: 'flex-start',
        backgroundColor: colors.Grey200,
        borderRadius: 4,
        padding: 8,
        marginTop: 16,
        marginBottom: 8,
    },
    noticeText: {
        ...styles.body2,
        color: colors.Text02,
        marginLeft: 8,
        flex: 1,
    },
    section: {
        marginTop: 16,
    },
    sectionLabel: {
        ...styles.overline,
        color: colors.Text03,
        marginBottom: 8,
    },
    navigation: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        marginTop: 16,
    },
    navigationAction: {
        marginRight: 16,
    },
    action: {
        ...styles.caption2,
        color: colors.Primary100,
    },
})
