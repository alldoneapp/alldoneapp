import React from 'react'
import { StyleSheet, View } from 'react-native'
import { colors } from '../../../styles/global'
import { applyPopoverWidth } from '../../../../utils/HelperFunctions'
import Header from './Header'
import CommentOption from './CommentOption'
import EstimationOption from './EstimationOption'
import NextWorkflowOption from './NextWorkflowOption'
import Buttons from './Buttons'
import { TASK_ASSIGNEE_ASSISTANT_TYPE } from '../../../TaskListView/Utils/TasksHelper'

export default function MainModal({
    projectId,
    onPressClose,
    openCommentModal,
    comment,
    removeComment,
    openEstimationModal,
    estimations,
    openNextWorkflowStepModal,
    wasSelectedACustomStep,
    stopObserving,
    moveNextOrSelectedStep,
    steps,
    selectedNextStep,
    task,
    isNonTeamMember,
}) {
    const isAssistant = task.assigneeType === TASK_ASSIGNEE_ASSISTANT_TYPE

    return (
        <View style={[localStyles.container, applyPopoverWidth()]}>
            <Header onPressClose={onPressClose} />
            <View style={localStyles.subsection}>
                <CommentOption openCommentModal={openCommentModal} comment={comment} removeComment={removeComment} />
                {!isAssistant && (
                    <EstimationOption
                        projectId={projectId}
                        openEstimationModal={openEstimationModal}
                        estimations={estimations}
                    />
                )}
                <NextWorkflowOption
                    projectId={projectId}
                    wasSelectedACustomStep={wasSelectedACustomStep}
                    openNextWorkflowStepModal={openNextWorkflowStepModal}
                    steps={steps}
                    selectedNextStep={selectedNextStep}
                    task={task}
                />
                <Buttons
                    moveNextOrSelectedStep={moveNextOrSelectedStep}
                    stopObserving={stopObserving}
                    isNonTeamMember={isNonTeamMember}
                    isAssistant={isAssistant}
                />
            </View>
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        flexDirection: 'column',
        width: 305,
        shadowColor: 'rgba(78, 93, 120, 0.56)',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 1,
        shadowRadius: 16,
        elevation: 3,
        borderRadius: 4,
        backgroundColor: colors.Secondary400,
    },
    subsection: {
        marginTop: 20,
        paddingHorizontal: 16,
    },
})
