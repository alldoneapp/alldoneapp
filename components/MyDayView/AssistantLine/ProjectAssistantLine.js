import React from 'react'
import { useSelector } from 'react-redux'

import AssistantLine from './AssistantLine'
import { useProjectAssistantLine } from './useAssistantLineSwitch'

// Mount only in the selected project's section. All Projects owns one global line,
// so its individual sections must not request assistant collections of their own.
export default function ProjectAssistantLine({ project }) {
    const isAnonymous = useSelector(state => state.loggedUser.isAnonymous)
    const { hasAssistantLine, assistantLineProps } = useProjectAssistantLine(isAnonymous ? null : project)

    return !isAnonymous && hasAssistantLine ? <AssistantLine {...assistantLineProps} /> : null
}
