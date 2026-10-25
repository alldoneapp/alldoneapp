import React from 'react'
import { StyleSheet, Text, View } from 'react-native'

import Icon from '../Icon'
import styles, { colors } from '../styles/global'
import { translate } from '../../i18n/TranslationService'

/**
 * Bar width for "how busy was this project compared with the busiest one".
 *
 * A project with any completed task gets at least 8% so the fill is visible;
 * an unknown or zero count gets no fill at all.
 */
export const getProjectActivityWidth = (doneTasks, maxDoneTasks) => {
    if (typeof doneTasks !== 'number' || doneTasks <= 0) return 0
    if (typeof maxDoneTasks !== 'number' || maxDoneTasks <= 0) return 0
    return `${Math.max(8, Math.round((doneTasks / maxDoneTasks) * 100))}%`
}

/**
 * "Tasks done: N" plus an activity bar, under a project name on the dark
 * rating card.
 *
 * Extracted from the "new day" popup so the on-demand rating popup in
 * Settings → Happiness shows the same line for the day being rated. Both hosts
 * pass the count they read from `statistics/{projectId}/{userId}/{DDMMYYYY}`;
 * `doneTasks` that is not a number means "not loaded (yet)" and renders a
 * dash instead of a misleading zero.
 */
export default function ProjectDayActivity({ doneTasks, maxDoneTasks, testID }) {
    const known = typeof doneTasks === 'number'

    return (
        <>
            <View style={localStyles.stats} testID={testID}>
                <Icon name="check-square" size={16} color={colors.Text04} />
                <Text style={localStyles.statsText}>
                    {translate('Tasks done:')} {known ? doneTasks : '–'}
                </Text>
            </View>
            <View style={localStyles.track}>
                <View style={[localStyles.fill, { width: getProjectActivityWidth(doneTasks, maxDoneTasks) }]} />
            </View>
        </>
    )
}

const localStyles = StyleSheet.create({
    stats: {
        flexDirection: 'row',
        alignItems: 'center',
        marginTop: 4,
    },
    statsText: {
        ...styles.caption2,
        color: colors.Text04,
        marginLeft: 4,
    },
    track: {
        height: 4,
        borderRadius: 2,
        backgroundColor: 'rgba(255,255,255,0.12)',
        marginTop: 8,
        overflow: 'hidden',
    },
    fill: {
        height: 4,
        borderRadius: 2,
        backgroundColor: colors.Primary300,
    },
})
