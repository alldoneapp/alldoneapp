import React, { useMemo, useState } from 'react'
import { StyleSheet, Text, TouchableOpacity } from 'react-native'
import { useDispatch, useSelector } from 'react-redux'

import { colors } from '../../styles/global'
import Icon from '../../Icon'
import AppPopover from '../../UIComponents/ModalShell/AppPopover'
import AssistantSwitchModal from '../../UIComponents/FloatModals/ChangeAssistantModal/AssistantSwitchModal'
import { hideFloatPopup, showFloatPopup } from '../../../redux/actions'
import { translate } from '../../../i18n/TranslationService'
import { countAssistantOptions, getToggleTargetOption } from './assistantSwitchOptions'

export const ASSISTANT_SWITCH_BUTTON_TEST_ID = 'assistant-line-switch-button'

/**
 * AT-2430 — the `repeat` button in the assistant line, in both of its shapes.
 *
 * Fewer than two options means there is nothing to switch to, so nothing is rendered — a control
 * that cannot change anything is worse than no control. Exactly two options toggle directly,
 * which is what the in-project switch has always done and is one click instead of three. Three
 * or more open the popup, because a blind toggle through a 33-entry ring is not a control.
 *
 * With a `label` (the assistant line's header) the control IS the assistant's name: the name with
 * a chevron when there is something to switch to, plain text when there is not.
 *
 * The press handler stops propagation on purpose: in the collapsed layout this button sits
 * inside the row's own `TouchableOpacity`, whose job is to expand the line.
 */
export default function AssistantSwitchControl({
    groups = [],
    activeProjectId = null,
    activeAssistantId = null,
    onSelect,
    grouped = false,
    collapsed = false,
    inline = false,
    label = null,
    labelStyle,
}) {
    const dispatch = useDispatch()
    const smallScreenNavigation = useSelector(state => state.smallScreenNavigation)
    const [isOpen, setIsOpen] = useState(false)

    const optionCount = useMemo(() => countAssistantOptions(groups), [groups])

    const openModal = () => {
        setIsOpen(true)
        dispatch(showFloatPopup())
    }

    const closeModal = () => {
        setIsOpen(false)
        dispatch(hideFloatPopup())
    }

    const onPress = event => {
        event?.preventDefault?.()
        event?.stopPropagation?.()

        if (optionCount > 2) {
            openModal()
            return
        }

        const target = getToggleTargetOption(groups, activeProjectId, activeAssistantId)
        if (target) onSelect?.(target)
    }

    if (optionCount < 2) {
        return label ? (
            <Text style={[localStyles.labelText, labelStyle]} numberOfLines={1}>
                {label}
            </Text>
        ) : null
    }

    const button = label ? (
        <TouchableOpacity
            style={localStyles.labelButton}
            onPress={onPress}
            testID={ASSISTANT_SWITCH_BUTTON_TEST_ID}
            accessibilityLabel={translate('Switch assistant')}
        >
            <Text style={[localStyles.labelText, labelStyle]} numberOfLines={1}>
                {label}
            </Text>
            <Icon name={'chevron-down'} size={16} color={colors.Text03} style={localStyles.labelChevron} />
        </TouchableOpacity>
    ) : (
        <TouchableOpacity
            style={[localStyles.switchButton, (collapsed || inline) && localStyles.switchButtonCollapsed]}
            onPress={onPress}
            testID={ASSISTANT_SWITCH_BUTTON_TEST_ID}
            accessibilityLabel={translate('Switch assistant')}
        >
            <Icon name={'repeat'} size={16} color={colors.Text03} />
        </TouchableOpacity>
    )

    if (optionCount <= 2) return button

    return (
        <AppPopover
            key={!isOpen}
            content={
                <AssistantSwitchModal
                    closeModal={closeModal}
                    groups={groups}
                    grouped={grouped}
                    activeProjectId={activeProjectId}
                    activeAssistantId={activeAssistantId}
                    onSelect={onSelect}
                />
            }
            align={'start'}
            position={['bottom', 'right', 'left', 'top']}
            onClickOutside={closeModal}
            isOpen={isOpen}
            contentLocation={smallScreenNavigation ? null : undefined}
        >
            {button}
        </AppPopover>
    )
}

const localStyles = StyleSheet.create({
    switchButton: {
        position: 'absolute',
        left: 0,
        top: -4,
        width: 28,
        height: 28,
        flexShrink: 0,
        borderRadius: 14,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: colors.Grey300,
        zIndex: 1,
    },
    labelButton: {
        flexDirection: 'row',
        alignItems: 'center',
        flexShrink: 1,
        minWidth: 0,
    },
    labelText: {
        flexShrink: 1,
        fontSize: 15,
        fontWeight: '600',
        color: colors.Text01,
    },
    labelChevron: {
        marginLeft: 2,
    },
    switchButtonCollapsed: {
        position: 'relative',
        left: 0,
        top: 0,
        marginRight: 8,
    },
})
