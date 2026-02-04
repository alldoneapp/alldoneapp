import React, { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react'
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
    const smallScreen = useSelector(state => state.smallScreen)
    const [isOpen, setIsOpen] = useState(false)
    const dispatch = useDispatch()
    const timeoutsRef = useRef([])
    const isUnmountedRef = useRef(false)

    useImperativeHandle(ref, () => ({
        close: () => closeModal(),
    }))

    useEffect(() => {
        return () => {
            isUnmountedRef.current = true
            timeoutsRef.current.forEach(id => clearTimeout(id))
            timeoutsRef.current = []
        }
    }, [])

    const safeSetIsOpen = value => {
        if (!isUnmountedRef.current) {
            setIsOpen(value)
        }
    }

    const openModal = () => {
        storeModal(MORE_BUTTON_EDITS_MODAL_ID)
        dispatch(showFloatPopup())
        safeSetIsOpen(true)
        onOpenModal?.()
    }

    const closeModal = () => {
        removeModal(MORE_BUTTON_EDITS_MODAL_ID)
        dispatch(hideFloatPopup())
        safeSetIsOpen(false)
        onCloseModal?.()
    }

    const delayCloseModal = e => {
        e?.preventDefault?.()
        e?.stopPropagation?.()
        if (!openModals[MENTION_MODAL_ID]) {
            const id = setTimeout(() => {
                closeModal()
            })
            timeoutsRef.current.push(id)
        }
    }

    return (
        <View style={wrapperStyle}>
            {isOpen ? (
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
                    isOpen={true}
                    contentLocation={smallScreen ? null : undefined}
                    padding={4}
                    onClickOutside={delayCloseModal}
                    disableReposition
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
            ) : (
                <MoreButton
                    onPress={openModal}
                    buttonStyle={buttonStyle}
                    disabled={disabled}
                    shortcut={shortcut}
                    inMentionModal={inMentionModal}
                    noBorder={noBorder}
                    iconSize={iconSize}
                />
            )}
        </View>
    )
}

export default forwardRef(MoreButtonWrapper)
