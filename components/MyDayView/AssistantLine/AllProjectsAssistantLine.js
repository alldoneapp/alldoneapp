import React from 'react'

import AssistantLine from './AssistantLine'
import { useAllProjectsAssistantLine } from './useAllProjectsAssistantLine'

/**
 * AT-2430 — the assistant line on the home / start page ("All projects" and MyDay).
 *
 * It behaves exactly as before — the default assistant, answering out of the global
 * conversation — but now carries the same assistant switch (the name in the header) the in-project line has. Picking
 * anybody else moves the user to that assistant's project with it active, which is why this
 * wrapper exists at all: six screens render the home line, and the switch has to behave
 * identically on every one of them.
 */
export default function AllProjectsAssistantLine(props) {
    const assistantSwitch = useAllProjectsAssistantLine()

    // AT-3034: its assistant-mode button opens the sidebar on "Automatic" (the default assistant).
    return (
        <AssistantLine
            useAssistantProjectContext={false}
            assistantSwitch={assistantSwitch}
            assistantModeProjectId={null}
            {...props}
        />
    )
}
