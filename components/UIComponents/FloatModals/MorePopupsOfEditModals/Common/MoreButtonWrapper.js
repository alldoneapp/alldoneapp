import React, { forwardRef, useImperativeHandle, useState } from 'react'
import { View } from 'react-native'
import Popover from 'react-tiny-popover'
import MoreButton from './MoreButton'
import { useDispatch, useSelector } from 'react-redux'
import {
    MORE_BUTTON_EDITS_MODAL_ID,
    MENTION_MODAL_ID,
    removeModal,
    storeModal,
    TASK_PARENT_GOAL_MODAL_ID,
} from '../../../../ModalsManager/modalsManager'
import MoreButtonModal from './MoreButtonModal'
import { hideFloatPopup, showFloatPopup } from '../../../../../redux/actions'

function MoreButtonWrapper(
    {
        children,
        formType,
        projectId,
        object,
        objectType,
        customModal,
        wrapperStyle,
        buttonStyle,
        onOpenModal,
        onCloseModal,
        disabled,
        inMentionModal,
        noBorder,
        modalAlign,
        shortcut = 'M',
        iconSize,
    },
    ref
) {
    const openModals = useSelector(state => state.openModals)
    const isMiddleScreen = useSelector(state => state.isMiddleScreen)
    const [isOpen, setIsOpen] = useState(false)
    const dispatch = useDispatch()

    useImperativeHandle(ref, () => ({
        close: () => closeModal(),
    }))

    const openModal = () => {
        storeModal(MORE_BUTTON_EDITS_MODAL_ID)
        dispatch(showFloatPopup())
        setIsOpen(true)
        onOpenModal?.()
    }

    const closeModal = () => {
        removeModal(MORE_BUTTON_EDITS_MODAL_ID)
        dispatch(hideFloatPopup())
        setIsOpen(false)
        onCloseModal?.()
    }

    const delayCloseModal = e => {
        e?.preventDefault?.()
        e?.stopPropagation?.()
        if (!openModals[MENTION_MODAL_ID]) {
            setTimeout(() => {
                closeModal()
            })
        }
    }

    return (
        <View style={wrapperStyle}>
            <Popover
                content={
                    customModal || (
                        <MoreButtonModal
                            formType={formType}
                            object={object}
                            objectType={objectType}
                            closePopover={closeModal}
                            delayClosePopover={delayCloseModal}
                            children={children}
                        />
                    )
                }
                align={modalAlign ? modalAlign : 'end'}
                position={['bottom', 'left', 'right', 'top']}
                isOpen={isOpen}
                contentLocation={isMiddleScreen ? null : undefined}
                padding={4}
                onClickOutside={delayCloseModal}
            >
                <MoreButton
                    onPress={openModal}
                    buttonStyle={buttonStyle}
                    disabled={disabled}
                    shortcut={shortcut}
                    inMentionModal={inMentionModal}
                    noBorder={noBorder}
                    iconSize={iconSize}
                />
            </Popover>
        </View>
    )
}

export default forwardRef(MoreButtonWrapper)
