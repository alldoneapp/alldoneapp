import React, { forwardRef, useImperativeHandle, useState, useRef, useEffect, useContext } from 'react'
import { View } from 'react-native'
import AppPopover from '../../../ModalShell/AppPopover'
import { useDispatch, useSelector } from 'react-redux'

import MoreButton from './MoreButton'
import { HeaderActionsContext, taskHierarchyStyles } from '../../../../TaskListView/TaskHierarchy'
import { colors } from '../../../../styles/global'
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
        iconSize,
        iconColor,
        popupAlign,
        popupPosition,
        shortcut = 'M',
    },
    ref
) {
    const inHeader = useContext(HeaderActionsContext)
    const mobile = useSelector(state => state.smallScreenNavigation)
    const [isOpen, setIsOpen] = useState(false)
    const dispatch = useDispatch()
    const timeoutsRef = useRef([])
    const contentKey = customModal
        ? `custom-${customModal.key || customModal.type?.displayName || customModal.type?.name || 'modal'}`
        : 'main-menu'

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
        <View style={[wrapperStyle, inHeader && taskHierarchyStyles.headerMoreWrapper]}>
            {isOpen ? (
                <AppPopover
                    key={contentKey}
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
                    isOpen={true}
                    contentLocation={mobile ? null : undefined}
                    padding={0}
                    onClickOutside={delayCloseModal}
                >
                    <MoreButton
                        onPress={delayCloseModal}
                        buttonStyle={[
                            buttonStyle,
                            inHeader && taskHierarchyStyles.headerMoreButton,
                            inHeader && mobile && taskHierarchyStyles.headerMoreButtonMobile,
                        ]}
                        disabled={disabled}
                        shortcut={shortcut}
                        iconSize={iconSize}
                        iconColor={inHeader ? colors.Text02 : iconColor}
                    />
                </AppPopover>
            ) : (
                <MoreButton
                    onPress={openModal}
                    buttonStyle={[
                        buttonStyle,
                        inHeader && taskHierarchyStyles.headerMoreButton,
                        inHeader && mobile && taskHierarchyStyles.headerMoreButtonMobile,
                    ]}
                    disabled={disabled}
                    shortcut={shortcut}
                    iconSize={iconSize}
                    iconColor={inHeader ? colors.Text02 : iconColor}
                />
            )}
        </View>
    )
}

export default forwardRef(MoreButtonWrapper)
