import React from 'react'

import GhostButton from '../../UIControls/GhostButton'
import { translate } from '../../../i18n/TranslationService'
import {
    TASK_EXECUTION_MODE_DIRECT,
    TASK_EXECUTION_MODE_WORKFLOW,
    getTaskExecutionMode,
} from '../../../utils/taskExecutionMode'

export default function ExecutionModeButton({ task, disabled, onChange, style }) {
    const executionMode = getTaskExecutionMode(task)
    const usesWorkflow = executionMode === TASK_EXECUTION_MODE_WORKFLOW
    const nextMode = usesWorkflow ? TASK_EXECUTION_MODE_DIRECT : TASK_EXECUTION_MODE_WORKFLOW
    const label = translate(usesWorkflow ? 'Use workflow' : 'Bypass workflow')

    return (
        <GhostButton
            type="ghost"
            icon={usesWorkflow ? 'git-branch' : 'fast-forward'}
            title={label}
            buttonStyle={style}
            disabled={disabled}
            onPress={() => onChange(nextMode)}
            accessibilityLabel={label}
        />
    )
}
