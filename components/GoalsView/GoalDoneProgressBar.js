import React from 'react'
import { StyleSheet, View } from 'react-native'

import { GOAL_HIGHLIGHT_COLORS_LIGHT_VERSIONS_MAP } from '../../utils/ColorConstants'
import { sortBy } from 'lodash'

export default function GoalDoneProgressBar({ progressByDoneMilestone, milestoneId, barColor }) {
    const progressInMilestones = Object.entries(progressByDoneMilestone)

    const sortedProgress = sortBy(progressInMilestones, [item => item[1].doneDate])

    let progressInCurrentMilestone = progressByDoneMilestone[milestoneId].progress
        ? progressByDoneMilestone[milestoneId].progress
        : 0

    let previusProgress = 0
    sortedProgress.forEach((item, index) => {
        const previusItem = sortedProgress[index - 1]
        const mId = item[0]
        if (mId === milestoneId && previusItem) previusProgress = previusItem[1].progress
    })

    const currentProgress =
        progressInCurrentMilestone > 0
            ? ((progressInCurrentMilestone - previusProgress) / progressInCurrentMilestone) * 100
            : 0

    return (
        <View style={[localStyles.container, { width: `${progressInCurrentMilestone}%` }]}>
            {previusProgress > 0 && (
                <View
                    style={[
                        localStyles.bar,
                        {
                            width: `${
                                currentProgress > 0 ? (previusProgress / progressInCurrentMilestone) * 100 : 100
                            }%`,
                            backgroundColor: GOAL_HIGHLIGHT_COLORS_LIGHT_VERSIONS_MAP[barColor],
                        },
                    ]}
                />
            )}
            {currentProgress > 0 && (
                <View style={[localStyles.bar, { width: `${currentProgress}%`, backgroundColor: barColor }]} />
            )}
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        position: 'absolute',
        left: 0,
        top: 0,
        minHeight: 40,
        height: '100%',
        borderRadius: 4,
        flexDirection: 'row',
        backgroundColor: 'red',
    },
    bar: { height: '100%' },
})
