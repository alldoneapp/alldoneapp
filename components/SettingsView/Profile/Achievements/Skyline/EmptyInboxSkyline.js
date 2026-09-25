import React, { useEffect, useMemo, useRef, useState } from 'react'
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { useSelector } from 'react-redux'

import { translate } from '../../../../../i18n/TranslationService'
import styles, { colors } from '../../../../styles/global'
import { useReducedMotion } from '../../../../UIComponents/Ghosts/ghostAnimation'
import { buildSkylineDays, buildSkylineWeeks, formatSkylineMinutes } from './skylineData'

const MIN_HEIGHT = 240
const MAX_HEIGHT = 420

const getActiveProjects = (projects, user) =>
    (projects || []).filter(
        project =>
            project &&
            (user.projectIds || []).includes(project.id) &&
            !(user.archivedProjectIds || []).includes(project.id) &&
            !(user.templateProjectIds || []).includes(project.id) &&
            !(user.guideProjectIds || []).includes(project.id)
    )

/**
 * The Empty inbox card's year, drawn as a 3D city (replaces the 2D grid wherever WebGL exists; the
 * caller keeps the grid as the fallback).
 *
 * Each building is one day of the last quarter (13 weeks). Height is the tasks completed that day across the
 * user's active projects (`statistics/{projectId}/{userId}`), colour is the project that got most of
 * them, and a glowing green roof is a day the inbox was cleared — the same `emptyInboxDays` the grid
 * reads, so the two can never disagree about which days count.
 */
export default function EmptyInboxSkyline({ user, emptyInboxDays, celebrationRunId, width }) {
    const containerRef = useRef(null)
    const sceneRef = useRef(null)
    const [sceneReady, setSceneReady] = useState(false)
    const [sceneFailed, setSceneFailed] = useState(false)
    const [statistics, setStatistics] = useState({})
    const [hoverIndex, setHoverIndex] = useState(-1)
    const [selectedIndex, setSelectedIndex] = useState(-1)
    const reduceMotion = useReducedMotion()
    const loggedUserProjects = useSelector(state => state.loggedUserProjects)

    const projects = useMemo(
        () =>
            getActiveProjects(loggedUserProjects, user).map(project => ({
                id: project.id,
                name: project.name,
                color: project.color || colors.Primary100,
            })),
        [loggedUserProjects, user.projectIds, user.archivedProjectIds, user.templateProjectIds, user.guideProjectIds]
    )
    const projectIdsKey = projects.map(project => project.id).join('|')

    const weeks = useMemo(() => buildSkylineWeeks(emptyInboxDays), [emptyInboxDays])
    const days = useMemo(() => buildSkylineDays(weeks, statistics, projects), [weeks, statistics, projects])
    const todayIndex = useMemo(() => days.findIndex(day => day.isToday), [days])

    const labels = useMemo(
        () => ({
            months: weeks
                .map((week, index) =>
                    week.monthName ? { week: index, text: translate(week.monthName).slice(0, 3) } : null
                )
                .filter(Boolean),
            weekdays: [
                { weekday: 0, text: translate('Monday short') },
                { weekday: 2, text: translate('Wednesday short') },
                { weekday: 4, text: translate('Friday short') },
            ],
        }),
        [weeks]
    )

    // Statistics: one range read per active project, the past cached for the session.
    useEffect(() => {
        let cancelled = false
        if (!user.uid || !projects.length || !weeks.length) return undefined
        const startDate = weeks[0].days[0].date
        // Required lazily: the card that renders this is mounted by suites that must not pull the
        // Firebase client in, and only a browser that can draw the city ever gets here.
        const { loadSkylineStatistics } = require('../../../../../utils/backends/Users/skylineStatistics')
        loadSkylineStatistics(
            user.uid,
            projects.map(project => project.id),
            startDate
        ).then(result => {
            if (!cancelled) setStatistics(result)
        })
        return () => {
            cancelled = true
        }
    }, [user.uid, projectIdsKey, weeks.length ? weeks[0].days[0].dateKey : ''])

    // The scene lives in its own chunk; three.js is only downloaded here.
    useEffect(() => {
        let cancelled = false
        const container = containerRef.current
        if (!container) return undefined
        import(/* webpackChunkName: "skyline" */ './skylineScene')
            .then(({ createSkylineScene }) => {
                if (cancelled) return
                sceneRef.current = createSkylineScene(container, {
                    reduceMotion,
                    onHover: index => setHoverIndex(index),
                    onSelect: index => setSelectedIndex(index),
                })
                setSceneReady(true)
            })
            .catch(error => {
                console.warn('[skyline] Could not start the 3D view', error)
                if (!cancelled) setSceneFailed(true)
            })
        return () => {
            cancelled = true
            if (sceneRef.current) {
                sceneRef.current.destroy()
                sceneRef.current = null
            }
        }
    }, [])

    useEffect(() => {
        if (sceneReady && sceneRef.current) sceneRef.current.setDays(days, labels)
    }, [sceneReady, days, labels])

    useEffect(() => {
        if (sceneReady && sceneRef.current && celebrationRunId && todayIndex >= 0 && days[todayIndex].achieved) {
            sceneRef.current.celebrateToday()
        }
    }, [sceneReady, celebrationRunId])

    const shownIndex = hoverIndex >= 0 ? hoverIndex : selectedIndex >= 0 ? selectedIndex : todayIndex
    const shownDay = days[shownIndex]
    const height = Math.round(Math.max(MIN_HEIGHT, Math.min(MAX_HEIGHT, (width || 0) * 0.55)))

    if (sceneFailed) return null

    return (
        <View
            style={localStyles.container}
            // Claim the gesture so the achievements card this sits in does not treat a drag across
            // the city as a press on itself.
            onStartShouldSetResponder={() => true}
            onResponderTerminationRequest={() => false}
            testID="empty-inbox-skyline"
        >
            <View ref={containerRef} style={[localStyles.canvas, { height }]} />
            {shownDay ? (
                <View style={localStyles.dayLine}>
                    <Text style={localStyles.dayDate}>{shownDay.date.format('dddd, LL')}</Text>
                    <Text style={localStyles.dayFacts}>
                        {translate('Skyline tasks done', { count: shownDay.tasks })}
                        {formatSkylineMinutes(shownDay.minutes) ? ` · ${formatSkylineMinutes(shownDay.minutes)}` : ''}
                    </Text>
                    <View style={[localStyles.inboxChip, shownDay.achieved && localStyles.inboxChipOn]}>
                        {shownDay.achieved && <View style={localStyles.inboxDot} />}
                        <Text style={[localStyles.inboxText, shownDay.achieved && localStyles.inboxTextOn]}>
                            {translate(shownDay.achieved ? 'Skyline inbox cleared' : 'Skyline inbox not cleared')}
                        </Text>
                    </View>
                    {selectedIndex >= 0 && hoverIndex < 0 && (
                        <TouchableOpacity
                            onPress={() => {
                                setSelectedIndex(-1)
                                if (sceneRef.current) sceneRef.current.select(-1)
                            }}
                            accessibilityRole="button"
                        >
                            <Text style={localStyles.resetText}>{translate('Skyline back to today')}</Text>
                        </TouchableOpacity>
                    )}
                </View>
            ) : null}
            <Text style={localStyles.hint}>{translate('Skyline hint')}</Text>
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        width: '100%',
    },
    canvas: {
        width: '100%',
        backgroundColor: '#FFFFFF',
    },
    resetText: {
        ...styles.caption1,
        color: colors.Primary100,
    },
    dayLine: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        alignItems: 'center',
        justifyContent: 'center',
        columnGap: 10,
        rowGap: 6,
        marginTop: 12,
    },
    dayDate: {
        ...styles.subtitle2,
        color: colors.Text01,
    },
    dayFacts: {
        ...styles.caption1,
        color: colors.Text02,
    },
    inboxChip: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 8,
        paddingVertical: 2,
        borderRadius: 999,
        backgroundColor: colors.Grey200,
    },
    inboxChipOn: {
        backgroundColor: colors.UtilityGreen100,
    },
    inboxDot: {
        width: 6,
        height: 6,
        borderRadius: 3,
        marginRight: 6,
        backgroundColor: colors.UtilityGreen200,
    },
    inboxText: {
        ...styles.caption1,
        color: colors.Text03,
    },
    inboxTextOn: {
        color: colors.UtilityGreen300,
    },
    hint: {
        ...styles.caption2,
        color: colors.Text03,
        textAlign: 'center',
        marginTop: 6,
    },
})
