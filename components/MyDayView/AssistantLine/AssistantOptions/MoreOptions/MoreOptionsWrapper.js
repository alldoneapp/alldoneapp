import React, { useState } from 'react'
import { StyleSheet } from 'react-native'
import Popover from 'react-tiny-popover'
import { useDispatch } from 'react-redux'

import { hideFloatPopup, showFloatPopup } from '../../../../../redux/actions'
import MoreOptionsModal from './MoreOptionsModal'
import Button from '../../../../UIControls/Button'

export default function MoreOptionsWrapper({ projectId, options, assistant }) {
    const dispatch = useDispatch()
    const [isOpen, setIsOpen] = useState(false)

    const openModal = () => {
        setIsOpen(true)
        dispatch(showFloatPopup())
    }

    const closeModal = () => {
        setIsOpen(false)
        dispatch(hideFloatPopup())
    }

    return (
        <Popover
            content={
                <MoreOptionsModal
                    projectId={projectId}
                    closeModal={closeModal}
                    assistant={assistant}
                    options={options}
                />
            }
            align={'start'}
            position={['bottom', 'left', 'right', 'top']}
            onClickOutside={closeModal}
            isOpen={isOpen}
            contentLocation={null}
        >
            <Button
                type={'ghost'}
                icon={'more-vertical'}
                buttonStyle={localStyles.buttonStyle}
                noBorder={true}
                onPress={openModal}
                iconSize={20}
            />
        </Popover>
    )
}

const localStyles = StyleSheet.create({
    buttonStyle: {
        maxHeight: 22,
        maxWidth: 28,
        paddingVertical: 0,
        minHeight: 20,
        alignSelf: 'center',
        marginLeft: 4,
        paddingVertical: 1,
        paddingHorizontal: 4,
    },
})
