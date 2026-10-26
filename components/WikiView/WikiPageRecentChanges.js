import React, { useEffect, useMemo, useState } from 'react'
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native'

import styles, { colors } from '../styles/global'
import Icon from '../Icon'
import { translate } from '../../i18n/TranslationService'
import {
    getKnowledgePageRange,
    getKnowledgeRevisionNumberBefore,
} from '../../utils/backends/KnowledgeBase/knowledgeBaseFirestore'
import { isKnowledgePageVisible } from '../../functions/KnowledgeBase/knowledgeBaseModel'
import { getWikiChangeAuthorId, getWikiChangeKind } from '../../functions/KnowledgeBase/knowledgeWikiFeedModel'
import { ChangeContent, Notice } from './WikiPageChange'
import { formatWikiDate } from './useKnowledgeBase'
import { describeWikiChange } from './wikiChangeText'
import { buildWikiRangeOptions, getWikiRangeRevisions, resolveWikiRangeChange } from './wikiRecentChanges'

function RangeOptions({ options, since, pendingId, onPress }) {
    return (
        <View testID="wiki-range-options" style={localStyles.options}>
            {options.map(option => {
                const selected = option.base !== undefined && option.base === since
                return (
                    <TouchableOpacity
                        key={option.id}
                        testID={`wiki-range-${option.id}`}
                        style={[localStyles.option, selected && localStyles.optionSelected]}
                        disabled={selected || !!pendingId}
                        onPress={() => onPress(option)}
                        accessibilityRole="button"
                        accessibilityState={{ selected }}
                    >
                        <Text style={[localStyles.optionText, selected && localStyles.optionTextSelected]}>
                            {translate(`Wiki range ${option.id}`)}
                        </Text>
                    </TouchableOpacity>
                )
            })}
        </View>
    )
}

function IncludedChanges({ range, since, pageTitle, onOpenChange, onSelectSince }) {
    if (!range.total) return null
    return (
        <View testID="wiki-range-revisions" style={localStyles.section}>
            <Text style={localStyles.sectionLabel}>{translate('Wiki changes in range', { amount: range.total })}</Text>
            {range.listed.map(revision => {
                const number = Number(revision.revision)
                const title = revision.title || pageTitle
                const actorName = getWikiChangeAuthorId(revision)
                    ? revision.author?.name || translate('A project member')
                    : translate('The wiki')
                return (
                    <View key={number} testID={`wiki-range-revision-${number}`} style={localStyles.revisionRow}>
                        <Text style={localStyles.meta}>
                            {`${translate('Revision')} ${number} · ${formatWikiDate(revision.createdAt)}`}
                        </Text>
                        <Text style={localStyles.revisionText}>
                            {revision.redacted
                                ? translate('Revision redacted')
                                : describeWikiChange(getWikiChangeKind(revision), actorName, title)}
                        </Text>
                        {!revision.redacted && !!revision.reason && (
                            <Text style={localStyles.reason}>{revision.reason}</Text>
                        )}
                        <View style={localStyles.revisionActions}>
                            {!revision.redacted && (
                                <TouchableOpacity
                                    testID={`wiki-range-open-${number}`}
                                    onPress={() => onOpenChange(number)}
                                    accessible={false}
                                    style={localStyles.revisionAction}
                                >
                                    <Text style={localStyles.action}>{translate('Show this change')}</Text>
                                </TouchableOpacity>
                            )}
                            {number - 1 !== since && (
                                <TouchableOpacity
                                    testID={`wiki-range-from-${number}`}
                                    onPress={() => onSelectSince(number - 1)}
                                    accessible={false}
                                    style={localStyles.revisionAction}
                                >
                                    <Text style={localStyles.action}>{translate('Wiki compare from here')}</Text>
                                </TouchableOpacity>
                            )}
                        </View>
                    </View>
                )
            })}
            {range.notListed > 0 && (
                <Text testID="wiki-range-not-listed" style={localStyles.meta}>
                    {translate('Wiki changes not listed', { amount: range.notListed })}
                </Text>
            )}
        </View>
    )
}

/**
 * Everything a wiki page changed since one of its revisions, as ONE comparison with its newest
 * revision (AT-2878), plus the single changes the range is made of. Opened from the button at the
 * top of a page, which starts at the page's last change; the range buttons and "Compare from here"
 * move where it starts. Like the single change view, it compares only stored revisions: a revision
 * whose text the wiki removed is said to be unavailable and never pieced together from its neighbours.
 */
export default function WikiPageRecentChanges({
    projectId,
    slug,
    since,
    pageSlugs = new Set(),
    onSelectSince,
    onOpenChange,
    onOpenPage,
    onBack,
}) {
    const [state, setState] = useState({ status: 'loading' })
    const [lookup, setLookup] = useState({ pendingId: null, failed: false })

    useEffect(() => {
        let cancelled = false
        setState({ status: 'loading' })
        setLookup({ pendingId: null, failed: false })
        getKnowledgePageRange(projectId, slug, since)
            .then(result => !cancelled && setState({ status: 'loaded', ...(result || {}) }))
            .catch(() => !cancelled && setState({ status: 'failed' }))
        return () => {
            cancelled = true
        }
    }, [projectId, slug, since])

    const page = state.page || null
    const pageVisible = isKnowledgePageVisible(page)
    const latestNumber = Number(page?.revision) || 0
    const options = useMemo(
        () =>
            state.status === 'loaded'
                ? buildWikiRangeOptions({ currentRevision: latestNumber, revisions: state.revisions })
                : [],
        [state.status, state.revisions, latestNumber]
    )

    const backLink = (
        <TouchableOpacity
            testID="wiki-range-back"
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
            <View testID="wiki-range-loading">
                {backLink}
                <Text style={localStyles.meta}>{translate('Loading changes')}</Text>
            </View>
        )
    }
    // Only a page people can read now has recent changes to show; a page that is archived or waiting
    // for a rebuild is reached through its single changes (the Updates feed) instead.
    const change =
        state.status === 'loaded' && pageVisible ? resolveWikiRangeChange(since, state.base, state.latest) : null
    if (!change || change.status === 'missing') {
        return (
            <View testID="wiki-range-unavailable">
                {backLink}
                <Text style={localStyles.meta}>
                    {translate(state.status === 'failed' ? 'Could not load the changes' : 'Wiki change not found')}
                </Text>
            </View>
        )
    }

    const selectOption = async option => {
        if (option.base !== undefined) {
            onSelectSince(option.base)
            return
        }
        setLookup({ pendingId: option.id, failed: false })
        try {
            const base = await getKnowledgeRevisionNumberBefore(projectId, slug, option.lookupBefore)
            if (!Number.isInteger(base)) throw new Error('no revision number')
            setLookup({ pendingId: null, failed: false })
            onSelectSince(Math.min(base, Math.max(0, latestNumber - 1)))
        } catch (error) {
            setLookup({ pendingId: null, failed: true })
        }
    }

    const range = getWikiRangeRevisions(state.revisions, since, latestNumber)
    const baseDate = formatWikiDate(state.base?.createdAt)
    const heading =
        since === 0
            ? translate('Wiki changes since creation')
            : baseDate
              ? translate('Wiki changes since revision', { revision: since, date: baseDate })
              : translate('Wiki changes since revision without date', { revision: since })

    return (
        <View testID={`wiki-range-${slug}-${since}`}>
            {backLink}
            <Text style={localStyles.pageTitle}>{page.title}</Text>
            <Text testID="wiki-range-heading" style={localStyles.heading}>
                {heading}
            </Text>
            <RangeOptions options={options} since={since} pendingId={lookup.pendingId} onPress={selectOption} />
            {lookup.failed && <Text style={localStyles.error}>{translate('Could not load the changes')}</Text>}

            {change.status === 'empty' ? (
                <Notice testID="wiki-range-empty" text={translate('Wiki no changes since revision')} />
            ) : change.status === 'redacted' ? (
                <Notice testID="wiki-range-redacted" text={translate('Revision redacted')} />
            ) : (
                <ChangeContent
                    change={change}
                    sourceLabels={page.sourceLabels || {}}
                    pageSlugs={pageSlugs}
                    baseUnavailableText={translate('Wiki range base unavailable', { revision: since })}
                />
            )}

            <IncludedChanges
                range={range}
                since={since}
                pageTitle={page.title}
                onOpenChange={onOpenChange}
                onSelectSince={onSelectSince}
            />

            <View style={localStyles.navigation}>
                <TouchableOpacity testID="wiki-range-open-page" onPress={() => onOpenPage(slug)} accessible={false}>
                    <Text style={localStyles.action}>{translate('Open page')}</Text>
                </TouchableOpacity>
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
    heading: {
        ...styles.body2,
        color: colors.Text02,
        marginTop: 4,
    },
    meta: {
        ...styles.caption2,
        color: colors.Text03,
        marginTop: 4,
    },
    options: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        marginTop: 12,
    },
    option: {
        borderWidth: 1,
        borderColor: colors.Grey400,
        borderRadius: 12,
        paddingHorizontal: 10,
        paddingVertical: 2,
        marginRight: 6,
        marginBottom: 6,
    },
    optionSelected: {
        backgroundColor: colors.Grey200,
        borderColor: colors.Primary100,
    },
    optionText: {
        ...styles.body2,
        color: colors.Text02,
    },
    optionTextSelected: {
        color: colors.Primary100,
    },
    error: {
        ...styles.caption2,
        color: colors.UtilityRed200,
        marginTop: 4,
    },
    section: {
        marginTop: 24,
        borderTopWidth: 1,
        borderTopColor: colors.Grey300,
        paddingTop: 12,
    },
    sectionLabel: {
        ...styles.overline,
        color: colors.Text03,
        marginBottom: 8,
    },
    revisionRow: {
        marginBottom: 10,
    },
    revisionText: {
        ...styles.body2,
        color: colors.Text02,
    },
    reason: {
        ...styles.body2,
        color: colors.Text03,
        fontStyle: 'italic',
        marginTop: 2,
    },
    revisionActions: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        marginTop: 2,
    },
    revisionAction: {
        marginRight: 16,
    },
    navigation: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        marginTop: 16,
    },
    action: {
        ...styles.caption2,
        color: colors.Primary100,
    },
})
