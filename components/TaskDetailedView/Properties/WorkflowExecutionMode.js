import React from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { useSelector } from 'react-redux'

import Icon from '../../Icon'
import GhostButton from '../../UIControls/GhostButton'
import styles, { colors } from '../../styles/global'
import { translate } from '../../../i18n/TranslationService'
import { getUserWorkflow } from '../../ContactsView/Utils/ContactsHelper'
import { WORKSTREAM_ID_PREFIX } from '../../Workstreams/WorkstreamConstants'
import { isInboxSummaryGmailTask } from '../../../utils/Gmail/gmailTaskUtils'
import { setTaskExecutionMode } from '../../../utils/backends/Tasks/tasksFirestore'
import {
    TASK_EXECUTION_MODE_DIRECT,
    TASK_EXECUTION_MODE_WORKFLOW,
    taskBypassesWorkflow,
} from '../../../utils/taskExecutionMode'

// Calendar, generic (day-rate log) and inbox-summary Gmail tasks always complete straight to Done
// (see CheckBoxWrapper.toggleCheckAction), so a switch there would promise a choice that does not
// exist. A task already in direct mode always shows the switch, so it can be put back even when its
// owner has since removed every workflow step.
export const shouldShowExecutionModeSetting = (task, ownerWorkflow) => {
    if (task.calendarData || task.genericData || isInboxSummaryGmailTask(task.gmailData)) return false
    if (taskBypassesWorkflow(task)) return true
    return Object.keys(ownerWorkflow || {}).length > 0
}

export default function WorkflowExecutionMode({ projectId, task, disabled }) {
    const loggedUserId = useSelector(state => state.loggedUser.uid)
    const ownerIsWorkstream = task.userId?.startsWith(WORKSTREAM_ID_PREFIX)
    // The same lookup the checkbox uses to decide where a completed task goes.
    const ownerWorkflow = getUserWorkflow(projectId, ownerIsWorkstream ? loggedUserId : task.userId, task)

    if (!shouldShowExecutionModeSetting(task, ownerWorkflow)) return null

    const direct = taskBypassesWorkflow(task)
    const toggleMode = () =>
        setTaskExecutionMode(projectId, task, direct ? TASK_EXECUTION_MODE_WORKFLOW : TASK_EXECUTION_MODE_DIRECT)

    return (
        <View style={localStyles.container}>
            <View style={{ marginRight: 8 }}>
                <Icon name="check-square" size={24} color={colors.Text03} />
            </View>
            <Text style={[styles.subtitle2, { color: colors.Text03 }]}>{translate('On completion')}</Text>
            <View style={{ marginLeft: 'auto' }}>
                <GhostButton
                    type={'ghost'}
                    icon={direct ? 'fast-forward' : 'git-branch'}
                    title={translate(direct ? 'Straight to Done' : 'Through workflow')}
                    onPress={toggleMode}
                    disabled={disabled}
                    accessible={false}
                />
            </View>
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        flex: 1,
        flexDirection: 'row',
        maxHeight: 56,
        minHeight: 56,
        height: 56,
        paddingLeft: 8,
        paddingVertical: 8,
        alignItems: 'center',
    },
})
