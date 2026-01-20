import React from 'react'
import { StyleSheet, View } from 'react-native'
import { useDispatch, useSelector } from 'react-redux'
import moment from 'moment'

import GoalCommentsWrapper from './GoalCommentsWrapper'
import { LINKED_OBJECT_TYPE_GOAL, getDvTabLink } from '../../utils/LinkingHelper'
import BacklinksTag from '../Tags/BacklinksTag'
import DescriptionTag from '../Tags/DescriptionTag'
import { FEED_GOAL_OBJECT_TYPE, FEED_PUBLIC_FOR_ALL } from '../Feeds/Utils/FeedsConstants'
import ParentMilestonesWrapper from './EditGoalsComponents/ParentMilestonesWrapper'
import ObjectNoteTag from '../Tags/ObjectNoteTag'
import PrivacyTag from '../Tags/PrivacyTag'
import GoalItemAssigneesArea from './GoalItemAssigneesArea'
import CounterTag from '../Tags/CounterTag'
import URLTrigger from '../../URLSystem/URLTrigger'
import NavigationService from '../../utils/NavigationService'
import GoalDateTagButton from '../UIControls/GoalDateTagButton'
import { BACKLOG_DATE_NUMERIC } from '../TaskListView/Utils/TasksHelper'
import MilestoneDateTag from './MilestoneDateTag'
import store from '../../redux/store'
import { PROJECT_TYPE_ACTIVE } from '../SettingsView/ProjectsSettings/ProjectsSettings'
import { setWorkstreamLastVisitedBoardDate, WORKSTREAM_ID_PREFIX } from '../Workstreams/WorkstreamHelper'
import ProjectHelper from '../SettingsView/ProjectsSettings/ProjectHelper'
import ContactsHelper from '../ContactsView/Utils/ContactsHelper'
import { setSelectedSidebarTab, setSelectedTypeOfProject, storeCurrentUser, switchProject } from '../../redux/actions'
import { DV_TAB_ROOT_GOALS } from '../../utils/TabNavigationConstants'
import { setGoalDescription } from '../../utils/backends/Goals/goalsFirestore'

export default function GoalItemTagsArea({
    projectId,
    goal,
    assigneesIds,
    assigneesCapacity,
    commentsData,
    containerStyle,
    tagStyle,
    onLayoutTagsContainer,
    disableTagsActions,
    backlinksCount,
    backlinkObject,
    parentMilestonesData,
    inDoneMilestone,
    showAssignees,
    tasksAmount,
    isEmptyGoal,
    parentGoaltasks,
    areObservedTask,
    inParentGoal,
    loggedUserCanUpdateObject,
}) {
    const dispatch = useDispatch()
    const currentUserId = useSelector(state => state.currentUser.uid)

    const navigateToChildrenTasksView = () => {
        const path = getDvTabLink(projectId, goal.id, 'goals', 'tasks/open')
        URLTrigger.processUrl(NavigationService, path)
    }

    const goToGoals = e => {
        e?.preventDefault()
        const { loggedUser, currentUser } = store.getState()
        let projectType = PROJECT_TYPE_ACTIVE

        if (currentUser.uid.startsWith(WORKSTREAM_ID_PREFIX)) {
            setWorkstreamLastVisitedBoardDate(projectId, currentUser, 'lastVisitBoardInGoals')
        } else {
            projectType = ProjectHelper.getTypeOfProject(loggedUser, projectId)
            ContactsHelper.setUserLastVisitedBoardDate(projectId, currentUser, 'lastVisitBoardInGoals')
        }

        const projectIndex = ProjectHelper.getProjectIndexById(projectId)
        dispatch([
            setSelectedSidebarTab(DV_TAB_ROOT_GOALS),
            storeCurrentUser(currentUser),
            setSelectedTypeOfProject(projectType),
            switchProject(projectIndex),
        ])
    }

    const updateDescription = description => {
        setGoalDescription(projectId, goal.id, description, goal, goal.description)
    }

    const reminderDate = moment(goal.assigneesReminderDate[currentUserId])
    const reminderDateIsToday = reminderDate && reminderDate.isSame(moment(), 'day')

    const isInTaskList = inParentGoal || isEmptyGoal
    const showReminderDateTag =
        isInTaskList && goal.assigneesReminderDate[currentUserId] !== BACKLOG_DATE_NUMERIC && !reminderDateIsToday

    const milestoneDate =
        isInTaskList && goal.completionMilestoneDate !== BACKLOG_DATE_NUMERIC && moment(goal.completionMilestoneDate)

    return (
        <View
            onLayout={onLayoutTagsContainer}
            nativeID={`social_tags_${projectId}_${goal.id}`}
            style={[localStyles.container, containerStyle]}
        >
            <View nativeID={`initial_social_tag_${projectId}_${goal.id}`} />
            {!!commentsData && (
                <GoalCommentsWrapper
                    commentsData={commentsData}
                    projectId={projectId}
                    goal={goal}
                    tagStyle={tagStyle}
                    disabled={disableTagsActions}
                />
            )}
            {tasksAmount > 0 && (
                <CounterTag
                    icon={'linked-task'}
                    style={{ marginLeft: 8 }}
                    counter={tasksAmount}
                    onPress={navigateToChildrenTasksView}
                />
            )}
            {goal.timesPostponed >= 3 && (
                <CounterTag
                    icon={'coffee'}
                    style={{ marginLeft: 8 }}
                    counter={goal.timesPostponed}
                    onPress={goToGoals}
                    disabled={disableTagsActions}
                />
            )}
            {goal.noteId && (
                <ObjectNoteTag
                    objectId={goal.id}
                    objectType="goals"
                    projectId={projectId}
                    style={[{ marginLeft: 8 }, tagStyle]}
                    disabled={disableTagsActions}
                />
            )}
            {!goal.isPublicFor.includes(FEED_PUBLIC_FOR_ALL) && (
                <PrivacyTag
                    projectId={projectId}
                    object={goal}
                    objectType={FEED_GOAL_OBJECT_TYPE}
                    style={[{ marginLeft: 8 }, tagStyle]}
                    disabled={disableTagsActions || !loggedUserCanUpdateObject}
                />
            )}
            {backlinksCount > 0 && (
                <BacklinksTag
                    object={goal}
                    objectId={goal.id}
                    objectType={LINKED_OBJECT_TYPE_GOAL}
                    projectId={projectId}
                    style={[{ marginLeft: 8 }, tagStyle]}
                    backlinksCount={backlinksCount}
                    backlinkObject={backlinkObject}
                    disabled={disableTagsActions}
                />
            )}
            {goal.description !== '' && (
                <DescriptionTag
                    projectId={projectId}
                    object={goal}
                    style={[{ marginLeft: 8 }, tagStyle]}
                    objectType={FEED_GOAL_OBJECT_TYPE}
                    disabled={disableTagsActions || !loggedUserCanUpdateObject}
                    updateDescription={updateDescription}
                />
            )}

            {parentMilestonesData.milestonesAmount > 1 && (
                <ParentMilestonesWrapper
                    projectId={projectId}
                    goal={goal}
                    parentMilestonesData={parentMilestonesData}
                    tagStyle={tagStyle}
                    disabled={disableTagsActions || !loggedUserCanUpdateObject}
                />
            )}
            {showReminderDateTag && (
                <GoalDateTagButton
                    projectId={projectId}
                    disabled={disableTagsActions}
                    goal={goal}
                    isEmptyGoal={isEmptyGoal}
                    parentGoaltasks={parentGoaltasks}
                    areObservedTask={areObservedTask}
                    inParentGoal={inParentGoal || !loggedUserCanUpdateObject}
                />
            )}
            {milestoneDate && (
                <MilestoneDateTag
                    date={milestoneDate}
                    onMilestoneTagClick={goToGoals}
                    style={{ marginLeft: 8, marginRight: 0 }}
                    inDetailedView={true}
                />
            )}
            {showAssignees && (
                <GoalItemAssigneesArea
                    projectId={projectId}
                    goal={goal}
                    assigneesIds={assigneesIds}
                    assigneesCapacity={assigneesCapacity}
                    tagStyle={tagStyle}
                    disableTagsActions={disableTagsActions || !loggedUserCanUpdateObject}
                    inDoneMilestone={inDoneMilestone}
                />
            )}
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        flexDirection: 'row',
        alignItems: 'center',
    },
})
