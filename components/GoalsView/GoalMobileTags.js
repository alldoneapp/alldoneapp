import React, { useState } from 'react'
import { ScrollView, StyleSheet, View } from 'react-native'
import { useSelector } from 'react-redux'
import moment from 'moment'

import GoalItemTagsArea from './GoalItemTagsArea'
import TaskSummarizeTags from '../Tags/TaskSummarizeTags'
import ProjectHelper from '../SettingsView/ProjectsSettings/ProjectHelper'
import { BACKLOG_DATE_NUMERIC, getHandlerData } from '../TaskListView/Utils/TasksHelper'
import { FEED_PUBLIC_FOR_ALL } from '../Feeds/Utils/FeedsConstants'
import { getGoalFocusArea } from '../../functions/shared/goalFocusAreas'
import { GOAL_MILESTONES_MODE_LINEAR, normalizeGoalMilestonesConfig } from '../../utils/GoalMilestonesHelper'
import { translate } from '../../i18n/TranslationService'

// Count only tags rendered inside the group; the milestone date stays outside.
export function getMobileGoalTagsAmount(props, currentUserId, focusAreas, project) {
    const { goal, inParentGoal, isEmptyGoal, inCommentPopup, tasksAmount, backlinksCount, parentMilestonesData } = props
    const isInTaskList = !!(inParentGoal || isEmptyGoal)
    const reminderDate = goal.assigneesReminderDate[currentUserId]
    const assigneesAmount = props.inDoneMilestone
        ? goal.assigneesIds.length > 0
            ? 1
            : 0
        : goal.assigneesIds.filter(id => {
              const { handler, isPublicForLoggedUser } = getHandlerData(id, props.projectId)
              return handler && isPublicForLoggedUser
          }).length

    return (
        Number(isInTaskList && !!getGoalFocusArea(goal, focusAreas)) +
        Number(!!props.commentsData && !inCommentPopup) +
        Number(tasksAmount > 0) +
        Number(goal.timesPostponed >= 3) +
        Number(normalizeGoalMilestonesConfig(project?.goalMilestonesConfig).mode === GOAL_MILESTONES_MODE_LINEAR) +
        Number(!!goal.noteId) +
        Number(!goal.isPublicFor.includes(FEED_PUBLIC_FOR_ALL)) +
        Number(backlinksCount > 0) +
        Number(goal.description !== '') +
        Number(parentMilestonesData.milestonesAmount > 1) +
        Number(isInTaskList && reminderDate !== BACKLOG_DATE_NUMERIC && !moment(reminderDate).isSame(moment(), 'day')) +
        assigneesAmount
    )
}

export default function GoalMobileTags(props) {
    const [expanded, setExpanded] = useState(false)
    const currentUserId = useSelector(state => state.currentUser.uid)
    const focusAreas = useSelector(state => state.loggedUserProjectsMap?.[props.projectId]?.focusAreas)
    const project = ProjectHelper.getProjectById(props.projectId)
    const amountTags = getMobileGoalTagsAmount(props, currentUserId, focusAreas, project)

    const toggleTags = event => {
        event?.preventDefault()
        event?.stopPropagation()
        setExpanded(value => !value)
    }

    return (
        <View style={localStyles.container}>
            <View style={localStyles.collapsedRow}>
                <GoalItemTagsArea {...props} milestoneOnly />
                {amountTags > 0 && (
                    <TaskSummarizeTags
                        amountTags={amountTags}
                        onPress={toggleTags}
                        style={{ marginLeft: 8 }}
                        accessibilityLabel={translate('Tags')}
                        expanded={expanded}
                    />
                )}
            </View>
            {amountTags > 0 && expanded && (
                <ScrollView
                    horizontal
                    nativeID={`expanded_goal_tags_${props.projectId}_${props.goal.id}`}
                    style={localStyles.expandedRow}
                    contentContainerStyle={localStyles.expandedContent}
                >
                    <GoalItemTagsArea {...props} showAssignees hideMilestone />
                </ScrollView>
            )}
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: { flex: 1, minWidth: 0 },
    collapsedRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end' },
    expandedRow: { marginTop: 8 },
    expandedContent: { flexGrow: 1, justifyContent: 'flex-end', alignItems: 'center', paddingRight: 1 },
})
