import React from 'react'

import DismissibleItem from '../../UIComponents/DismissibleItem'
import EditAssistant from './EditAssistant'
import AssistantPresentation from './AssistantPresentation'

export default function AssistantItem({
    projectId,
    assistant,
    setDismissibleRefs,
    closeEdition,
    refKey,
    onAssistantClick,
}) {
    const setRef = ref => {
        setDismissibleRefs(ref, refKey)
    }

    const closeEditionMode = () => {
        closeEdition(refKey)
    }

    return (
        <DismissibleItem
            ref={setRef}
            defaultComponent={
                <AssistantPresentation
                    projectId={projectId}
                    assistant={assistant}
                    onAssistantClick={onAssistantClick}
                />
            }
            modalComponent={
                <EditAssistant
                    projectId={projectId}
                    refKey={refKey}
                    adding={false}
                    assistant={assistant}
                    onCancelAction={closeEditionMode}
                />
            }
        />
    )
}
