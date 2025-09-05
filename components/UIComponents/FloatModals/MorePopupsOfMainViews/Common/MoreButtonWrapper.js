import React, { forwardRef, useImperativeHandle, useState, useRef, useEffect } from 'react'
import { View } from 'react-native'
import Popover from 'react-tiny-popover'
import { useDispatch, useSelector } from 'react-redux'

import MoreButton from './MoreButton'
import { MORE_BUTTON_MAIN_VIEWS_MODAL_ID, removeModal, storeModal } from '../../../../ModalsManager/modalsManager'
import MoreButtonModal from '../../MorePopupsOfEditModals/Common/MoreButtonModal'
import { hideFloatPopup, showFloatPopup } from '../../../../../redux/actions'

function MoreButtonWrapper(
    {
        children,
        formType,
        object,
        objectType,
        customModal,
        wrapperStyle,
        buttonStyle,
        onOpenModal,
        onCloseModal,
        disabled,
        popupAlign,
        popupPosition,
        shortcut = 'M',
    },
    ref
) {
    const mobile = useSelector(state => state.smallScreenNavigation)
    const [isOpen, setIsOpen] = useState(false)
    const dispatch = useDispatch()
    const timeoutsRef = useRef([])

    useImperativeHandle(ref, () => ({
        close: () => closeModal(),
    }))

    useEffect(() => {
        return () => {
            // Clear all timeouts on unmount
            timeoutsRef.current.forEach(timeoutId => clearTimeout(timeoutId))
            timeoutsRef.current = []
        }
    }, [])

    const openModal = () => {
        storeModal(MORE_BUTTON_MAIN_VIEWS_MODAL_ID)
        dispatch(showFloatPopup())
        setIsOpen(true)
        onOpenModal?.()
    }

    const closeModal = () => {
        removeModal(MORE_BUTTON_MAIN_VIEWS_MODAL_ID)
        dispatch(hideFloatPopup())
        setIsOpen(false)
        onCloseModal?.()
    }

    const delayCloseModal = e => {
        e?.preventDefault?.()
        e?.stopPropagation?.()

        const timeoutId = setTimeout(() => {
            closeModal()
        })
        timeoutsRef.current.push(timeoutId)
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
                align={popupAlign || 'start'}
                position={popupPosition || ['bottom', 'right', 'left', 'top']}
                isOpen={isOpen}
                contentLocation={mobile ? null : undefined}
                padding={0}
                onClickOutside={delayCloseModal}
            >
                <MoreButton onPress={openModal} buttonStyle={buttonStyle} disabled={disabled} shortcut={shortcut} />
            </Popover>
        </View>
    )
}

export default forwardRef(MoreButtonWrapper)
