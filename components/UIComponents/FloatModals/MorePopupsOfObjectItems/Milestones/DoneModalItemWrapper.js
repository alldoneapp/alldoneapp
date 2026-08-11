import React from 'react'
import Popover from 'react-tiny-popover'
import { useSelector } from 'react-redux'
import { View } from 'react-native'

import ConfirmDoneMilestoneModal from '../../ConfirmDoneMilestoneModal'

export default function DoneModalItemWrapper({ moveMilestone, closeModal, projectId, milestoneDate }) {
    const mobile = useSelector(state => state.smallScreenNavigation)

    const moveMilestoneToDone = () => {
        moveMilestone()
        closeModal()
    }

    return (
        <Popover
            content={
                <ConfirmDoneMilestoneModal
                    projectId={projectId}
                    milestoneDate={milestoneDate}
                    moveMilestoneToDone={moveMilestoneToDone}
                    closeModal={closeModal}
                />
            }
            onClickOutside={closeModal}
            isOpen={true}
            position={['bottom', 'left', 'top', 'right']}
            padding={4}
            align={'start'}
            disableReposition={mobile}
            contentLocation={mobile ? null : undefined}
        >
            <View />
        </Popover>
    )
}
