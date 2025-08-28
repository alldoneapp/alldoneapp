import React from 'react'
import { StyleSheet } from 'react-native'
import AmountTag from '../FollowSwitchableTag/AmountTag'
import { FOLLOWED_TAB } from '../Utils/FeedsConstants'
import ProjectHeader from '../../TaskListView/Header/ProjectHeader'

export default function ProjectLabelFeed({ project, amountNewFeeds, feedActiveTab }) {
    return (
        <ProjectHeader
            projectIndex={project.index}
            projectId={project.id}
            badge={
                amountNewFeeds > 0 && (
                    <AmountTag
                        feedAmount={amountNewFeeds}
                        isFollowedButton={feedActiveTab === FOLLOWED_TAB}
                        style={localStyles.amountTag}
                    />
                )
            }
        />
    )
}

const localStyles = StyleSheet.create({
    amountTag: {
        marginTop: 0,
        alignItems: 'center',
        flexDirection: 'row',
        marginLeft: 6,
    },
})
