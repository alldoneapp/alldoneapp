import React from 'react'
import { StyleSheet, Text, View } from 'react-native'

import styles, { colors } from '../../styles/global'
import Icon from '../../Icon'
import Line from '../../Line'
import Avatar from '../../Avatar'
import { useSelector, useDispatch } from 'react-redux'
import HelperFunctions, { dismissAllPopups } from '../../../utils/HelperFunctions'
import { TouchableOpacity } from 'react-native-gesture-handler'
import {
    hideFloatPopup,
    setSelectedSidebarTab,
    setTaskViewToggleIndex,
    setTaskViewToggleSection,
    storeCurrentUser,
} from '../../../redux/actions'
import WorkflowStepsAvatars from './WorkflowStepsAvatars'
import FillLine from './FillLine'
import { DV_TAB_ROOT_TASKS } from '../../../utils/TabNavigationConstants'
import URLsTasks, { URL_PROJECT_USER_TASKS_OPEN } from '../../../URLSystem/Tasks/URLsTasks'
import NavigationService from '../../../utils/NavigationService'

export default function WorkflowHeader({
    projectId,
    currentStepId,
    assignee,
    reviewer,
    containerStyle,
    workflowDirectionText,
}) {
    const dispatch = useDispatch()
    const selectedSidebarTab = useSelector(state => state.selectedSidebarTab)

    const projectWorkflow = assignee.workflow[projectId]
    const currentStep = projectWorkflow[currentStepId]

    const assigneeName = assignee.displayName
    const description = currentStep.description
    const workflowText = `${workflowDirectionText} ${HelperFunctions.getFirstName(assigneeName)} • ${description}`

    const navigateToReviewerBoard = () => {
        dismissAllPopups(true, true, true)
        dispatch([
            storeCurrentUser(reviewer),
            setTaskViewToggleIndex(0),
            setTaskViewToggleSection('Open'),
            setSelectedSidebarTab(DV_TAB_ROOT_TASKS),
            hideFloatPopup(),
        ])
        let data = {
            projectId: projectId,
            userId: reviewer.uid,
        }
        URLsTasks.push(URL_PROJECT_USER_TASKS_OPEN, data, projectId, reviewer.uid)
        if (!selectedSidebarTab) {
            NavigationService.navigate('Root')
        }
    }

    return (
        <View style={[localStyles.container, containerStyle]}>
            <View style={localStyles.centeredRow}>
                <Avatar reviewerPhotoURL={assignee.photoURL} />
                <WorkflowStepsAvatars projectId={projectId} currentStepId={currentStepId} assignee={assignee} />
                <Line width={4} />
                <Icon style={{ marginLeft: -2 }} name="square-checked-gray" color={colors.Text03} size={20} />
                <TouchableOpacity style={{ marginLeft: 8 }} onPress={navigateToReviewerBoard}>
                    <Text style={[styles.caption1, { color: colors.Text03 }]}>{workflowText}</Text>
                </TouchableOpacity>
                <FillLine style={{ marginLeft: 8 }} />
            </View>
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        flexDirection: 'row',
        alignItems: 'center',
        height: 48,
        marginTop: 32,
        paddingBottom: 2,
        paddingLeft: 2,
    },
    centeredRow: {
        flex: 1,
        maxHeight: 28,
        flexDirection: 'row',
        alignItems: 'center',
    },
})
