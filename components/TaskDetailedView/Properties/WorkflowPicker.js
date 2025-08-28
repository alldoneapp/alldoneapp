import React, { useRef, useState } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { colors } from '../../styles/global'
import Popover from 'react-tiny-popover'
import StatusPicker from './StatusPicker'
import { hideFloatPopup, showFloatPopup } from '../../../redux/actions'
import TasksHelper, { DONE_STEP, OPEN_STEP } from '../../TaskListView/Utils/TasksHelper'
import Button from '../../UIControls/Button'
import Icon from '../../Icon'
import { chronoEntriesOrder } from '../../../utils/HelperFunctions'
import { useDispatch, useSelector } from 'react-redux'
import { WORKSTREAM_ID_PREFIX } from '../../Workstreams/WorkstreamHelper'
import { translate } from '../../../i18n/TranslationService'

const WorkflowPicker = ({ projectId, task, disabled }) => {
    const [visiblePopover, setVisiblePopover] = useState(false)
    const assignee = useSelector(state => state.assignee)
    const loggedUser = useSelector(state => state.loggedUser)
    const smallScreen = useSelector(state => state.smallScreen)
    const dispatch = useDispatch()
    const ownerIsWorkstream = task?.userId?.startsWith(WORKSTREAM_ID_PREFIX)
    const btnRef = useRef()

    const getStepData = workflow => {
        const workflowEntries = workflow ? Object.entries(workflow).sort(chronoEntriesOrder) : []
        let stepNumber = OPEN_STEP

        if (task.done) {
            stepNumber = DONE_STEP
        } else {
            for (let i = 0; i < workflowEntries.length; ++i) {
                if (workflowEntries[i][0] === task.stepHistory[task.stepHistory.length - 1]) {
                    stepNumber = i
                    break
                }
            }
        }

        switch (stepNumber) {
            case OPEN_STEP:
                return { number: OPEN_STEP, name: translate('Open') }
            case DONE_STEP:
                return { number: DONE_STEP, name: translate('Done') }
            default:
                return {
                    number: stepNumber + 1,
                    name: workflowEntries[stepNumber][1].description,
                }
        }
    }

    const getWorkflow = () => {
        let taskOwner = ownerIsWorkstream ? loggedUser : assignee || TasksHelper.getTaskOwner(task.userId, projectId)

        if (!taskOwner.workflow) {
            taskOwner.workflow = {}
        }

        return taskOwner.workflow[projectId] ? taskOwner.workflow[projectId] : {}
    }

    const showPopover = () => {
        setVisiblePopover(true)
        dispatch(showFloatPopup())
        btnRef?.current?.blur()
    }

    const hidePopover = () => {
        setVisiblePopover(false)
        dispatch(hideFloatPopup())
    }

    const workflow = getWorkflow()
    const stepData = getStepData(workflow)

    return (
        <Popover
            content={<StatusPicker workflow={workflow} projectId={projectId} task={task} hidePopover={hidePopover} />}
            onClickOutside={hidePopover}
            isOpen={visiblePopover}
            position={['bottom', 'left', 'right', 'top']}
            padding={4}
            align={'end'}
            contentLocation={smallScreen ? null : undefined}
        >
            <Button
                ref={btnRef}
                icon={
                    stepData.number === DONE_STEP ? (
                        <Icon name={'square-checked-gray'} size={20} color={colors.Text03} />
                    ) : (
                        <View style={localStyles.stepMarker}>
                            <Text style={localStyles.stepNumber}>
                                {stepData.number === OPEN_STEP ? '' : stepData.number}
                            </Text>
                        </View>
                    )
                }
                title={stepData.name}
                type={'ghost'}
                onPress={showPopover}
                disabled={disabled}
            />
        </Popover>
    )
}
export default WorkflowPicker

const localStyles = StyleSheet.create({
    stepMarker: {
        borderColor: colors.Text03,
        borderRadius: 4,
        borderWidth: 2,
        alignItems: 'center',
        justifyContent: 'center',
        height: 20,
        width: 20,
    },
    stepNumber: {
        color: colors.Text03,
        fontFamily: 'Roboto-Regular',
        fontSize: 10,
    },
})
