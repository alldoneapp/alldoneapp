import React from 'react'

import AssistantItem from './AssistantItem'

export default function AssistantsList({ projectId, assistants, setDismissibleRefs, closeEdition, onAssistantClick }) {
    return (
        <>
            {assistants.map(assistant => (
                <AssistantItem
                    projectId={projectId}
                    key={assistant.uid}
                    assistant={assistant}
                    setDismissibleRefs={setDismissibleRefs}
                    closeEdition={closeEdition}
                    refKey={assistant.uid}
                    onAssistantClick={onAssistantClick}
                />
            ))}
        </>
    )
}
