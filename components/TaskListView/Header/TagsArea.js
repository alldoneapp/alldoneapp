import React from 'react'
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { useSelector } from 'react-redux'

import Icon from '../../Icon'
import styles, { colors, windowTagStyle } from '../../styles/global'
import Avatar from '../../Avatar'
import Line from '../../Line'
import { translate } from '../../../i18n/TranslationService'
import SharedHelper from '../../../utils/SharedHelper'
import { chronoEntriesOrder } from '../../../utils/HelperFunctions'
import AddTaskTag from '../../Tags/AddTaskTag'
import AddGoalTag from '../../Tags/AddGoalTag'
import ProjectHelper, { checkIfSelectedProject } from '../../SettingsView/ProjectsSettings/ProjectHelper'
import { FEED_TASK_OBJECT_TYPE } from '../../Feeds/Utils/FeedsConstants'
import { getUserPresentationData } from '../../ContactsView/Utils/ContactsHelper'

export default function TagsArea({
    projectId,
    workflow,
    user,
    mobile,
    onClickWorkflowIndicator,
    showWorkflow,
    showAddTask,
    showAddGoal,
    setPressedShowMoreMainSection,
}) {
    const loggedUser = useSelector(state => state.loggedUser)
    const currentUserId = useSelector(state => state.currentUser.uid)
    const selectedProjectIndex = useSelector(state => state.selectedProjectIndex)
    const accessGranted = SharedHelper.accessGranted(loggedUser, projectId)

    const workflowEntries = workflow ? Object.entries(workflow).sort(chronoEntriesOrder) : []

    const loggedUserIsBoardOwner = loggedUser.uid === currentUserId
    const loggedUserCanUpdateObject =
        loggedUserIsBoardOwner || !ProjectHelper.checkIfLoggedUserIsNormalUserInGuide(projectId)

    const isSelectedProject = checkIfSelectedProject(selectedProjectIndex)

    return (
        <View style={localStyles.container}>
            {showWorkflow && (
                <TouchableOpacity
                    style={localStyles.workflowIndicator}
                    onPress={onClickWorkflowIndicator}
                    disabled={!accessGranted}
                >
                    <View style={localStyles.workflowIndicator}>
                        <Icon
                            name="next-workflow"
                            size={16}
                            color={colors.Text03}
                            style={mobile && localStyles.workflowIconMobile}
                        />
                        <View style={localStyles.centeredRow}>
                            {!mobile && (
                                <Text style={[styles.subtitle2, localStyles.workflowLabel, windowTagStyle()]}>
                                    {translate('Workflow')}
                                </Text>
                            )}
                            <Avatar reviewerPhotoURL={user.photoURL} size={16} />
                            <Line />
                            {workflowEntries.map((step, index) => (
                                <View key={index} style={localStyles.centeredRow}>
                                    <Avatar
                                        reviewerPhotoURL={getUserPresentationData(step[1].reviewerUid).photoURL}
                                        size={16}
                                    />
                                    <Line width={index === workflowEntries.length - 1 ? 4 : 2} />
                                </View>
                            ))}
                            <View style={{ marginLeft: -2 }}>
                                <Icon name="square-checked-gray" color={colors.Text03} size={16} />
                            </View>
                        </View>
                    </View>
                </TouchableOpacity>
            )}
            {showAddTask && loggedUserCanUpdateObject && accessGranted && (
                <AddTaskTag
                    projectId={projectId}
                    style={{ marginLeft: 8 }}
                    setPressedShowMoreMainSection={setPressedShowMoreMainSection}
                    sourceType={FEED_TASK_OBJECT_TYPE}
                    expandTaskListIfNeeded={true}
                />
            )}
            {showAddGoal && loggedUserCanUpdateObject && accessGranted && (
                <AddGoalTag projectId={projectId} style={{ marginLeft: 8 }} />
            )}
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        flexDirection: 'row',
        height: 24,
        maxHeight: 24,
    },
    workflowIndicator: {
        height: 24,
        backgroundColor: colors.Grey300,
        paddingHorizontal: 4,
        borderRadius: 50,
        flexDirection: 'row',
        alignItems: 'center',
    },
    centeredRow: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    workflowIconMobile: {
        marginRight: 6,
    },
    workflowLabel: {
        color: colors.Text03,
        marginLeft: 6,
        marginRight: 8,
    },
})
