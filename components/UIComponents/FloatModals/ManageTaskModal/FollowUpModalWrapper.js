import React from 'react'
import { View } from 'react-native'
import Popover from 'react-tiny-popover'
import { useSelector } from 'react-redux'

import FollowUpModal from '../../../FollowUp/FollowUpModal'
import { popoverToCenter } from '../../../../utils/HelperFunctions'

export default function FollowUpModalWrapper({ task, projectId, followUpModalIsOpen, closeFollowUpModal }) {
    const smallScreenNavigation = useSelector(state => state.smallScreenNavigation)
    return (
        <Popover
            content={
                <FollowUpModal
                    task={task}
                    projectId={projectId}
                    hidePopover={closeFollowUpModal}
                    cancelPopover={closeFollowUpModal}
                />
            }
            onClickOutside={closeFollowUpModal}
            isOpen={followUpModalIsOpen}
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
