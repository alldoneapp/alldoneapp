import React from 'react'
import { useSelector } from 'react-redux'

import OptionButton from './OptionButton'
import { TASK_OPTION } from '../helper'
import OptionButtonWrapper from './OptionButtonWrapper'
import { TASK_TYPE_PROMPT } from '../../../../UIComponents/FloatModals/PreConfigTaskModal/TaskModal'

export default function OptionButtons({ projectId, options, assistant }) {
    const isExecuting = useSelector(state => state.preConfigTaskExecuting)

    console.log('[PreConfig] OptionButtons: Render', {
        isExecuting,
        optionsCount: options.length,
        timestamp: new Date().toISOString(),
    })

    const isTaskWithPromptAndVariables = (type, task) => {
        return type === TASK_OPTION && task.type === TASK_TYPE_PROMPT && task.variables.length > 0
    }

    return (
        <>
            {options.map(({ id, type, text, icon, action, task }) => {
                return isTaskWithPromptAndVariables(type, task) ? (
                    <OptionButtonWrapper
                        key={id}
                        projectId={projectId}
                        containerStyle={{ marginHorizontal: 8, marginBottom: 8 }}
                        text={text}
                        icon={icon}
                        task={task}
                        assistant={assistant}
                    />
                ) : (
                    <OptionButton
                        key={id}
                        text={text}
                        icon={icon}
                        containerStyle={{ marginHorizontal: 8, marginBottom: 8 }}
                        onPress={action}
                        disabled={isExecuting}
                    />
                )
            })}
        </>
    )
}
