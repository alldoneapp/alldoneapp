import React from 'react'
import { useSelector } from 'react-redux'

import OptionButton from './OptionButton'
import { TASK_OPTION } from '../helper'
import OptionButtonWrapper from './OptionButtonWrapper'
import { TASK_TYPE_PROMPT } from '../../../../UIComponents/FloatModals/PreConfigTaskModal/TaskModal'

export default function OptionButtons({ projectId, options, assistant }) {
    const isExecuting = useSelector(state => state.preConfigTaskExecuting)

    return (
        <>
            {options.map(option => (
                <OptionItem
                    key={option.id}
                    projectId={projectId}
                    option={option}
                    assistant={assistant}
                    isExecuting={isExecuting}
                />
            ))}
        </>
    )
}

function OptionItem({ projectId, option, assistant, isExecuting }) {
    const { id, type, text, icon, action, task } = option
    const isDisabled = isExecuting === task?.name
    const lastClickTimeRef = React.useRef(0)

    const handlePress = () => {
        const now = Date.now()
        if (now - lastClickTimeRef.current > 1000) {
            lastClickTimeRef.current = now
            action()
        }
    }

    const isTaskWithPromptAndVariables = (type, task) => {
        return type === TASK_OPTION && task.type === TASK_TYPE_PROMPT && task.variables.length > 0
    }

    if (isTaskWithPromptAndVariables(type, task)) {
        return (
            <OptionButtonWrapper
                projectId={projectId}
                containerStyle={{ marginHorizontal: 8, marginBottom: 8 }}
                text={text}
                icon={icon}
                task={task}
                assistant={assistant}
            />
        )
    }

    return (
        <OptionButton
            text={text}
            icon={icon}
            containerStyle={{ marginHorizontal: 8, marginBottom: 8 }}
            onPress={handlePress}
            disabled={isDisabled}
        />
    )
}
