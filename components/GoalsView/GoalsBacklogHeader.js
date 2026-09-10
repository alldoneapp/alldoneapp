import React from 'react'
import { useProjectSectionAccent, useProjectSectionBorder, taskHierarchyStyles } from '../TaskListView/TaskHierarchy'
import { StyleSheet, Text, View } from 'react-native'
import styles, { colors } from '../styles/global'
import MilestoneStatistics from './MilestoneStatistics'
import moment from 'moment'
import MilestoneMoreButton from '../UIComponents/FloatModals/MorePopupsOfObjectItems/Milestones/MilestoneMoreButton'
import { useSelector } from 'react-redux'
import { translate } from '../../i18n/TranslationService'
import { BACKLOG_DATE_NUMERIC } from '../TaskListView/Utils/TasksHelper'
import ProjectHelper from '../SettingsView/ProjectsSettings/ProjectHelper'

export default function GoalsBacklogHeader({ projectId, previousMilestoneDate, milestoneId, goals }) {
    const accentColor = useProjectSectionAccent()
    const borderColor = useProjectSectionBorder()
    const loggedUser = useSelector(state => state.loggedUser)
    const currentUserId = useSelector(state => state.currentUser.uid)
    const backlogLikeMilestone = {
        id: milestoneId,
        date: BACKLOG_DATE_NUMERIC,
        done: false,
    }

    const loggedUserIsBoardOwner = loggedUser.uid === currentUserId
    const loggedUserCanUpdateObject =
        loggedUserIsBoardOwner || !ProjectHelper.checkIfLoggedUserIsNormalUserInGuide(projectId)

    return (
        <View style={[localStyles.container, accentColor && { backgroundColor: accentColor }]}>
            <Text style={localStyles.title}>{translate('Someday')}</Text>
            <MilestoneStatistics
                projectId={projectId}
                previousMilestoneTimestamp={previousMilestoneDate}
                milestoneTimestamp={moment('5000-01-01').valueOf()} // Max timestamp in ES8
                inDone={false}
                inBacklog={true}
            />

            {!loggedUser.isAnonymous && loggedUserCanUpdateObject && (
                <View style={localStyles.moreButtonContainer}>
                    <MilestoneMoreButton projectId={projectId} milestone={backlogLikeMilestone} goals={goals} />
                </View>
            )}
            <View
                pointerEvents="none"
                style={[taskHierarchyStyles.goalRowOutline, { borderWidth: 1 }, borderColor && { borderColor }]}
            />
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        alignContent: 'center',
        paddingHorizontal: 8,
        paddingBottom: 2,
        backgroundColor: colors.Grey100,
        borderRadius: 7,
    },
    title: {
        ...styles.title7,
        color: colors.Text02,
        marginTop: 10,
    },
    moreButtonContainer: {
        position: 'absolute',
        right: 4,
        top: 4,
    },
})
