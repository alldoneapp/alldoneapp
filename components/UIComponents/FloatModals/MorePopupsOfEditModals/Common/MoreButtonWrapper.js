import React, { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react'
import { View } from 'react-native'
import AppPopover from '../../../ModalShell/AppPopover'
import MoreButton from './MoreButton'
import { useSelector } from 'react-redux'
import {
    MORE_BUTTON_EDITS_MODAL_ID,
    MENTION_MODAL_ID,
    removeModal,
    storeModal,
    TASK_PARENT_GOAL_MODAL_ID,
} from '../../../../ModalsManager/modalsManager'
import MoreButtonModal from './MoreButtonModal'
import { popoverToCenter } from '../../../../../utils/HelperFunctions'
import useFloatPopupLock from '../../../../../hooks/useFloatPopupLock'

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
    const [isOpen, setIsOpen] = useState(false)
    const timeoutsRef = useRef([])
    const isUnmountedRef = useRef(false)
    const ownsModalRef = useRef(false)
    const popupLock = useFloatPopupLock()

    useImperativeHandle(ref, () => ({
        close: () => closeModal(),
    }))

    useEffect(() => {
        return () => {
            isUnmountedRef.current = true
            timeoutsRef.current.forEach(id => clearTimeout(id))
            timeoutsRef.current = []
            if (ownsModalRef.current) {
                ownsModalRef.current = false
                removeModal(MORE_BUTTON_EDITS_MODAL_ID)
            }
        }
    }, [])

    const safeSetIsOpen = value => {
        if (!isUnmountedRef.current) {
            setIsOpen(value)
        }
    }

    const openModal = () => {
        storeModal(MORE_BUTTON_EDITS_MODAL_ID)
        ownsModalRef.current = true
        popupLock.acquire()
        safeSetIsOpen(true)
        onOpenModal?.()
    }

    const closeModal = () => {
        removeModal(MORE_BUTTON_EDITS_MODAL_ID)
        ownsModalRef.current = false
        popupLock.release()
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
                <AppPopover
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
                    contentLocation={popoverToCenter}
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
                </AppPopover>
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
