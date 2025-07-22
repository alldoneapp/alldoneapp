import React from 'react'
import { View } from 'react-native'
import Popover from 'react-tiny-popover'
import { popoverToSafePosition } from '../../utils/HelperFunctions'
import { useSelector } from 'react-redux'
import RichCreateTaskModal from '../UIComponents/FloatModals/RichCreateTaskModal/RichCreateTaskModal'

export default function SwipeNewTaskWrapper({ projectId, objectId, sourceType, showPopup, cancelPopover }) {
    const mobile = useSelector(state => state.smallScreenNavigation)

    return (
        <Popover
            content={
                <RichCreateTaskModal
                    initialProjectId={projectId}
                    sourceType={sourceType}
                    sourceId={objectId}
                    closeModal={cancelPopover}
                />
            }
            onClickOutside={cancelPopover}
            isOpen={showPopup}
            padding={4}
            position={['top']}
            align={'center'}
            contentLocation={args => popoverToSafePosition(args, mobile)}
            disableReposition
        >
            <View />
        </Popover>
    )
}
