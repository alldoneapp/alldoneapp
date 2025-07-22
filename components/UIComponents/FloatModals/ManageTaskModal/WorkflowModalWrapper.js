import React from 'react'
import { View } from 'react-native'
import Popover from 'react-tiny-popover'
import { useSelector } from 'react-redux'

import WorkflowModal from '../../../WorkflowModal/WorkflowModal'
import { popoverToCenter } from '../../../../utils/HelperFunctions'
import { WORKSTREAM_ID_PREFIX } from '../../../Workstreams/WorkstreamHelper'

export default function WorkflowModalWrapper({
    task,
    projectId,
    workflowModalIsOpen,
    closeWorkflowModal,
    workflow,
    inReview,
}) {
    const smallScreenNavigation = useSelector(state => state.smallScreenNavigation)
    const ownerIsWorkstream = task?.userId?.startsWith(WORKSTREAM_ID_PREFIX)
    return (
        <Popover
            content={
                <WorkflowModal
                    workflow={workflow}
                    projectId={projectId}
                    task={task}
                    hidePopover={closeWorkflowModal}
                    cancelPopover={closeWorkflowModal}
                    pending={inReview}
                    ownerIsWorkstream={ownerIsWorkstream}
                />
            }
            onClickOutside={closeWorkflowModal}
            isOpen={workflowModalIsOpen}
            padding={4}
            position={['top']}
            align={'center'}
            contentLocation={args => popoverToCenter(args, smallScreenNavigation)}
            disableReposition
        >
            <View />
        </Popover>
    )
}
