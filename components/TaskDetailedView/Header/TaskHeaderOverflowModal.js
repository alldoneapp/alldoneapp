import React, { useEffect, useState } from 'react'
import { StyleSheet, View } from 'react-native'
import { useDispatch } from 'react-redux'

import { colors } from '../../styles/global'
import { TASK_HEADER_OVERFLOW_MODAL_ID, removeModal, storeModal } from '../../ModalsManager/modalsManager'
import { applyPopoverWidth } from '../../../utils/HelperFunctions'
import { translate } from '../../../i18n/TranslationService'
import ModalHeader from '../../UIComponents/FloatModals/ModalHeader'
import ModalItem from '../../UIComponents/FloatModals/MorePopupsOfEditModals/Common/ModalItem'
import PrivacyModal from '../../UIComponents/FloatModals/PrivacyModal/PrivacyModal'
import { FEED_TASK_OBJECT_TYPE } from '../../Feeds/Utils/FeedsConstants'
import { openGlobalSearch } from '../../UIControls/DvSearchButton'
import { openViewInNewWindow } from '../../../utils/openInNewWindow'
import { themed } from '../../../Themes/colorMode'

/**
 * The task header's secondary actions (AT-3081). The header keeps the assistant and Copy link
 * visible; this menu holds what used to be a row of extra buttons and the default
 * "Project-wide" visibility tag. A private task keeps its chip in the header instead, so the
 * visibility entry is only offered when the caller says so.
 *
 * Choosing the visibility entry swaps the menu for the same `PrivacyModal` the header tag opens,
 * so changing visibility from here is exactly the flow it was before.
 */
export default function TaskHeaderOverflowModal({
    projectId,
    task,
    showVisibility,
    visibilityDisabled,
    canSearch,
    closeModal,
    delayCloseModal,
}) {
    const dispatch = useDispatch()
    const [showPrivacy, setShowPrivacy] = useState(false)

    useEffect(() => {
        storeModal(TASK_HEADER_OVERFLOW_MODAL_ID)
        return () => removeModal(TASK_HEADER_OVERFLOW_MODAL_ID)
    }, [])

    if (showPrivacy) {
        return (
            <PrivacyModal
                object={task}
                objectType={FEED_TASK_OBJECT_TYPE}
                projectId={projectId}
                closePopover={closeModal}
                delayClosePopover={delayCloseModal}
            />
        )
    }

    const items = []
    if (showVisibility) {
        items.push({
            key: 'visibility',
            icon: 'unlock',
            text: translate('Visibility with value', { value: translate('Project-wide') }),
            disabled: visibilityDisabled,
            onPress: () => setShowPrivacy(true),
        })
    }
    if (canSearch) {
        items.push({
            key: 'search',
            icon: 'search',
            text: translate('Search'),
            onPress: () => {
                closeModal()
                openGlobalSearch(dispatch)
            },
        })
    }
    items.push({
        key: 'new-window',
        icon: 'new-window',
        text: translate('Open view in new window'),
        onPress: () => {
            closeModal()
            openViewInNewWindow()
        },
    })

    return (
        <View testID="task-header-overflow-menu" style={[localStyles.container, applyPopoverWidth()]}>
            <ModalHeader closeModal={closeModal} title={translate('More options')} description={''} />
            {items.map((item, index) => (
                <ModalItem
                    key={item.key}
                    icon={item.icon}
                    notTranslatedText={item.text}
                    shortcut={`${index + 1}`}
                    disabled={item.disabled}
                    onPress={item.onPress}
                />
            ))}
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        backgroundColor: colors.Secondary400,
        borderRadius: 4,
        boxShadow: themed.PopupShadow,
        elevation: 3,
        padding: 16,
    },
})
