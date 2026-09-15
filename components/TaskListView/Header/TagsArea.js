import React from 'react'
import { useTaskHierarchy } from '../TaskHierarchy'
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { useSelector } from 'react-redux'

import Icon from '../../Icon'
import styles, { colors, windowTagStyle } from '../../styles/global'
import { translate } from '../../../i18n/TranslationService'
import SharedHelper from '../../../utils/SharedHelper'
import AddTaskTag from '../../Tags/AddTaskTag'
import AddGoalTag from '../../Tags/AddGoalTag'
import ProjectHelper, { checkIfSelectedProject } from '../../SettingsView/ProjectsSettings/ProjectHelper'
import { FEED_TASK_OBJECT_TYPE } from '../../Feeds/Utils/FeedsConstants'
import TaskHeaderMoreButton from '../../UIComponents/FloatModals/MorePopupsOfMainViews/Tasks/TaskHeaderMoreButton'
import GoalMoreButton from '../../UIComponents/FloatModals/MorePopupsOfMainViews/Goals/GoalMoreButton'

export default function TagsArea({
    projectId,
    mobile,
    onClickWorkflowIndicator,
    showWorkflow,
    showAddTask,
    showAddGoal,
    setPressedShowMoreMainSection,
}) {
    const taskHierarchy = useTaskHierarchy()
    const loggedUser = useSelector(state => state.loggedUser)
    const currentUserId = useSelector(state => state.currentUser.uid)
    const selectedProjectIndex = useSelector(state => state.selectedProjectIndex)
    const taskViewToggleSection = useSelector(state => state.taskViewToggleSection)
    const accessGranted = SharedHelper.accessGranted(loggedUser, projectId)

    const workflowLabel = translate('Workflow')

    const loggedUserIsBoardOwner = loggedUser.uid === currentUserId
    const loggedUserCanUpdateObject =
        loggedUserIsBoardOwner || !ProjectHelper.checkIfLoggedUserIsNormalUserInGuide(projectId)

    const isSelectedProject = checkIfSelectedProject(selectedProjectIndex)

    return (
        <View
            style={[localStyles.container, taskHierarchy && { height: mobile ? 36 : 32, maxHeight: mobile ? 36 : 32 }]}
        >
            {showWorkflow && (
                <TouchableOpacity
                    style={localStyles.workflowIndicator}
                    onPress={onClickWorkflowIndicator}
                    disabled={!accessGranted}
                    accessibilityLabel={workflowLabel}
                    title={mobile ? workflowLabel : undefined}
                >
                    <Icon name="next-workflow" size={16} color={colors.Text03} style={localStyles.workflowIcon} />
                    {!mobile && (
                        <Text style={[styles.subtitle2, localStyles.workflowLabel, windowTagStyle()]}>
                            {workflowLabel}
                        </Text>
                    )}
                </TouchableOpacity>
            )}
            {showAddTask && loggedUserCanUpdateObject && accessGranted && (
                <>
                    <AddTaskTag
                        projectId={projectId}
                        style={{ marginLeft: 8 }}
                        setPressedShowMoreMainSection={setPressedShowMoreMainSection}
                        sourceType={FEED_TASK_OBJECT_TYPE}
                        expandTaskListIfNeeded={true}
                        primary={true}
                        headerAction={taskHierarchy}
                    />
                    {taskViewToggleSection === 'Open' && (
                        <TaskHeaderMoreButton
                            projectIdOverride={projectId}
                            userId={currentUserId}
                            wrapperStyle={[
                                localStyles.taskMoreWrapper,
                                taskHierarchy && { marginLeft: 6, marginTop: 0 },
                            ]}
                            buttonStyle={[
                                localStyles.taskMoreButton,
                                taskHierarchy && localStyles.headerMoreButton,
                                taskHierarchy && mobile && { width: 36, height: 36 },
                            ]}
                            iconSize={16}
                            iconColor={taskHierarchy ? colors.Text02 : undefined}
                        />
                    )}
                </>
            )}
            {showAddGoal && loggedUserCanUpdateObject && accessGranted && (
                <>
                    <AddGoalTag projectId={projectId} style={{ marginLeft: 8 }} />
                    <GoalMoreButton
                        wrapperStyle={localStyles.goalMoreWrapper}
                        buttonStyle={localStyles.goalMoreButton}
                        iconSize={16}
                    />
                </>
            )}
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        flexDirection: 'row',
        alignItems: 'center',
        height: 24,
        maxHeight: 24,
        // Same rule as the other project-line action clusters: the title block on the left is the
        // one that gives way, so these controls are never squashed on narrow screens (AT-2263).
        flexShrink: 0,
    },
    workflowIndicator: {
        height: 24,
        backgroundColor: colors.Grey300,
        paddingHorizontal: 4,
        borderRadius: 50,
        flexDirection: 'row',
        alignItems: 'center',
    },
    workflowIcon: {
        marginHorizontal: 4,
    },
    workflowLabel: {
        color: colors.Text03,
        marginLeft: 2,
        marginRight: 4,
    },
    headerMoreButton: {
        width: 32,
        height: 32,
        borderRadius: 8,
        backgroundColor: 'rgba(255, 255, 255, 0.85)',
    },
    taskMoreWrapper: {
        marginLeft: 2,
        marginTop: 3,
    },
    taskMoreButton: {
        width: 18,
        height: 18,
        minWidth: 18,
        minHeight: 18,
    },
    goalMoreWrapper: {
        marginLeft: 2,
        marginTop: 3,
    },
    goalMoreButton: {
        width: 18,
        height: 18,
        minWidth: 18,
        minHeight: 18,
    },
})
