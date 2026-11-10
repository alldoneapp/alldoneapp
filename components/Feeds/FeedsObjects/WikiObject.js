import React, { useEffect, useState } from 'react'
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { useSelector } from 'react-redux'
import moment from 'moment'

import styles, { colors } from '../../styles/global'
import Icon from '../../Icon'
import { translate } from '../../../i18n/TranslationService'
import {
    getWikiFeedTarget,
    getWikiSourceChange,
    WIKI_CHANGE_ARCHIVED,
    WIKI_CHANGE_CORRECTED,
    WIKI_CHANGE_CREATED,
    WIKI_CHANGE_RESTORED,
    WIKI_CHANGE_UPDATED,
} from '../../../functions/KnowledgeBase/knowledgeWikiFeedModel'
import { watchWikiDayFeeds } from '../../../utils/backends/Feeds/wikiDayFeeds'
import { openProjectWiki, openProjectWikiChange, openProjectWikiSettings } from '../../WikiView/wikiLinks'
import WikiPageChangedFeed from '../FeedsTypes/WikiPageChangedFeed'
import WikiSourceChangedFeed from '../FeedsTypes/WikiSourceChangedFeed'
import useWikiFeedPageTitle from '../FeedsTypes/useWikiFeedPageTitle'
import useWikiDayCost from './wikiDayCost'
import { FOLLOWED_TAB } from '../Utils/FeedsConstants'
import NewFeedDot from '../FollowSwitchableTag/NewFeedDot'
import { getTimeFormatForDateFormat } from '../../../utils/dateTimeFormats'

const PREVIEW_LIMIT = 3
const COUNT_LABELS = {
    [WIKI_CHANGE_CREATED]: 'Wiki digest count new',
    [WIKI_CHANGE_UPDATED]: 'Wiki digest count updated',
    [WIKI_CHANGE_ARCHIVED]: 'Wiki digest count archived',
}
const PAGE_LABELS = {
    [WIKI_CHANGE_CREATED]: 'Wiki digest page new',
    [WIKI_CHANGE_UPDATED]: 'Wiki digest page updated',
    [WIKI_CHANGE_ARCHIVED]: 'Archived',
}

function groupChanges(feeds) {
    const byPage = new Map()
    for (const feed of feeds) {
        const target = getWikiFeedTarget(feed)
        if (!target) continue
        if (!byPage.has(target.slug)) byPage.set(target.slug, [])
        byPage.get(target.slug).push({ feed, ...target })
    }

    const pages = []
    for (const [slug, changes] of byPage) {
        changes.sort((a, b) => b.revision - a.revision)
        const [latest] = changes
        // Count each page once. A page created and edited today is still new, unless archived.
        let status = WIKI_CHANGE_UPDATED
        if (latest.change === WIKI_CHANGE_ARCHIVED) status = WIKI_CHANGE_ARCHIVED
        else if (changes.some(change => change.change === WIKI_CHANGE_CREATED)) status = WIKI_CHANGE_CREATED
        const memberEdit = changes.some(
            change => change.change === WIKI_CHANGE_CORRECTED || change.change === WIKI_CHANGE_RESTORED
        )
        pages.push({ slug, latest, changes, status, memberEdit })
    }
    return pages.sort(
        (a, b) =>
            Number(b.memberEdit) - Number(a.memberEdit) || b.latest.feed.lastChangeDate - a.latest.feed.lastChangeDate
    )
}

// A page row leads with the time of its newest revision today (the one the row opens), in local
// time and the user's time format, like every other line in the Updates feed.
function WikiDigestPage({ page, projectId, disabled }) {
    const { slug, latest, status, memberEdit } = page
    const title = useWikiFeedPageTitle(projectId, slug, latest.revision)
    const timeFormat = useSelector(state => getTimeFormatForDateFormat(state.dateFormat))
    const changedAt = latest.feed.lastChangeDate
    return (
        <TouchableOpacity
            testID={`wiki-digest-page-${slug}`}
            style={localStyles.page}
            accessibilityRole="button"
            accessibilityHint={translate('Show changes')}
            disabled={disabled}
            onPress={() => openProjectWikiChange(projectId, slug, latest.revision)}
        >
            {!!changedAt && (
                <Text testID={`wiki-digest-page-time-${slug}`} style={localStyles.time}>
                    {moment(changedAt).format(timeFormat)}
                </Text>
            )}
            <Text style={localStyles.pageTitle} numberOfLines={1}>
                {title}
            </Text>
            <Text style={localStyles.meta}>{translate(PAGE_LABELS[status])}</Text>
            {memberEdit && <Text style={localStyles.memberEdit}>{translate('Wiki digest member edit')}</Text>}
        </TouchableOpacity>
    )
}

// The Updates feed has one wiki card per project and display day. Summarize its changes first,
// then show the original revision lines, grouped by page, when the card is expanded.
export default function WikiObject({ feedObjectData, projectId, day, feedActiveTab, style }) {
    const activeModalInFeed = useSelector(state => state.activeModalInFeed)
    const isMiddleScreen = useSelector(state => state.isMiddleScreen)
    const userId = useSelector(state => state.currentUser?.uid)
    const [expanded, setExpanded] = useState(false)
    const [daySnapshot, setDaySnapshot] = useState(null)
    const dayCost = useWikiDayCost(projectId, day)
    const { feeds } = feedObjectData
    const scope = `${projectId}/${day}/${userId}/${feedActiveTab}`

    useEffect(
        () =>
            watchWikiDayFeeds(
                projectId,
                day,
                userId,
                feedActiveTab === FOLLOWED_TAB,
                (entries, complete) => setDaySnapshot({ scope, entries, complete }),
                () => setDaySnapshot({ scope, entries: [], complete: false })
            ),
        [projectId, day, userId, feedActiveTab, scope]
    )

    const snapshot = daySnapshot?.scope === scope ? daySnapshot : null
    // Keep unread decorations (and any newly delivered entries awaiting the reader projection)
    // from the feed list. Count each revision only once across the two sources.
    const byId = new Map((snapshot?.entries || []).map(feed => [feed.id, feed]))
    for (const feed of feeds) byId.set(feed.id, feed)
    const pages = groupChanges(byId.values())
    // Sources members handed the wiki or took back today: listed by themselves, newest first, because
    // they are not page revisions and the pages they change come later, from the wiki's own run.
    const sourceChanges = [...byId.values()]
        .filter(feed => getWikiSourceChange(feed))
        .sort((a, b) => (b.lastChangeDate || 0) - (a.lastChangeDate || 0))
    const hasUnreadChanges = feeds.some(feed => feed.showLikeNew)
    if (!pages.length && !sourceChanges.length) return null

    const counts = {}
    for (const { status } of pages) counts[status] = (counts[status] || 0) + 1
    const summary = Object.entries(COUNT_LABELS)
        .filter(([status]) => counts[status])
        .map(([status, label]) => translate(label, { count: counts[status] }))
        .join(' · ')
    const toggleLabel = expanded ? translate('Wiki digest hide revisions') : translate('Wiki digest show revisions')

    return (
        <View testID="wiki-feed-object" style={style}>
            <TouchableOpacity
                testID="wiki-feed-header"
                style={localStyles.header}
                onPress={() => openProjectWiki(projectId)}
                disabled={activeModalInFeed}
                accessibilityRole="button"
                accessibilityHint={translate('Open wiki')}
            >
                {!expanded && hasUnreadChanges && (
                    <NewFeedDot feedActiveTab={feedActiveTab} isMiddleScreen={isMiddleScreen} />
                )}
                <Icon name="book-open" color={colors.Text03} size={24} />
                <Text style={localStyles.title} numberOfLines={1}>
                    {translate('Project wiki')}
                </Text>
            </TouchableOpacity>
            <View style={localStyles.digest}>
                {!!summary && (
                    <Text testID="wiki-digest-summary" style={localStyles.summary}>
                        {summary}
                    </Text>
                )}
                {sourceChanges.map(feed => (
                    <WikiSourceChangedFeed
                        key={feed.id}
                        feed={feed}
                        projectId={projectId}
                        showNewFeedDot={feed.showLikeNew}
                        feedActiveTab={feedActiveTab}
                    />
                ))}
                {!snapshot?.complete && (
                    <Text style={localStyles.meta}>{translate('Wiki digest showing available changes')}</Text>
                )}
                {dayCost && (
                    <Text testID="wiki-digest-cost" style={localStyles.meta}>
                        {translate('Wiki digest cost', { gold: dayCost.gold })}
                        {dayCost.running ? ` · ${translate('Wiki digest run in progress')}` : ''}
                        {' · '}
                        <Text
                            testID="wiki-digest-settings"
                            style={localStyles.link}
                            accessibilityRole="link"
                            onPress={activeModalInFeed ? undefined : () => openProjectWikiSettings(projectId)}
                        >
                            {translate('Wiki settings')}
                        </Text>
                    </Text>
                )}
                {(expanded ? pages : pages.slice(0, PREVIEW_LIMIT)).map(page => (
                    <View key={page.slug} style={localStyles.group}>
                        <WikiDigestPage
                            key={page.latest.revision}
                            page={page}
                            projectId={projectId}
                            disabled={activeModalInFeed}
                        />
                        {expanded &&
                            page.changes.map(({ feed }) => (
                                <WikiPageChangedFeed
                                    key={feed.id}
                                    feed={feed}
                                    projectId={projectId}
                                    showNewFeedDot={feed.showLikeNew}
                                    feedActiveTab={feedActiveTab}
                                />
                            ))}
                    </View>
                ))}
                {pages.length > 0 && (
                    <TouchableOpacity
                        testID="wiki-digest-toggle"
                        style={localStyles.toggle}
                        accessibilityRole="button"
                        accessibilityState={{ expanded }}
                        disabled={activeModalInFeed}
                        onPress={() => setExpanded(value => !value)}
                    >
                        <Text style={localStyles.toggleText}>{toggleLabel}</Text>
                        <Icon name={expanded ? 'chevron-up' : 'chevron-down'} size={16} color={colors.Primary100} />
                    </TouchableOpacity>
                )}
            </View>
        </View>
    )
}

const localStyles = StyleSheet.create({
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingVertical: 8,
    },
    title: {
        ...styles.body1,
        color: colors.Text01,
        paddingLeft: 12,
        flex: 1,
    },
    digest: {
        marginLeft: 36,
    },
    summary: {
        ...styles.body2,
        color: colors.Text02,
    },
    group: {
        marginTop: 4,
    },
    page: {
        flexDirection: 'row',
        alignItems: 'center',
        flexWrap: 'wrap',
        gap: 8,
        paddingVertical: 4,
    },
    time: {
        ...styles.body3,
        color: colors.Text03,
    },
    pageTitle: {
        ...styles.body2,
        color: colors.Primary100,
        flexShrink: 1,
    },
    meta: {
        ...styles.body3,
        color: colors.Text03,
    },
    link: {
        color: colors.Primary100,
    },
    memberEdit: {
        ...styles.body3,
        color: colors.Text02,
    },
    toggle: {
        flexDirection: 'row',
        alignItems: 'center',
        alignSelf: 'flex-start',
        gap: 4,
        paddingVertical: 8,
    },
    toggleText: {
        ...styles.body2,
        color: colors.Primary100,
    },
})
