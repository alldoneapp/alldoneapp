import React, { useEffect, useRef, useState } from 'react'
import { StyleSheet, TouchableOpacity, View } from 'react-native'
import { useDispatch } from 'react-redux'

import AppPopover from '../../../../UIComponents/ModalShell/AppPopover'
import Icon from '../../../../Icon'
import { colors } from '../../../../styles/global'
import { hideFloatPopup, showFloatPopup } from '../../../../../redux/actions'
import { translate } from '../../../../../i18n/TranslationService'
import { getThreadAssistantModelName } from '../../../../../functions/Assistant/threadAssistantModel'
import { getAssistantDefaultModelName } from './assistantDefaultModel'

// The picker is required only when it opens: its module reaches `utils/HelperFunctions`, and with
// it the redux store and the Firebase client. A static import would drag all of that into every
// composer test that merely renders this button (the `threadAssistantModel` backend's pattern).
const getPickerModal = () => require('./ThreadAssistantModelModal').default

const DEFAULT_POSITION = ['top', 'bottom', 'left', 'right']

/**
 * The model button of the chat composers (AT-3162), right of "Templates" in the Anna composer and
 * in the assistant line.
 *
 * It is the comment popup's model choice (AT-2502) behind a button of its own: the same picker
 * (`ThreadAssistantModelModal`, with its "Use assistant model" entry first) and the same stored
 * field, so there is one model menu, one validation and one place where the server reads the pin.
 * Where the choice goes is the caller's: the Anna composer pins the chat on screen, the assistant
 * line applies it to the chat its next message starts.
 *
 * It shows only the chip icon, at every width, so it stays a quiet extra beside "Templates" rather
 * than a second pill. A chosen model is marked with the same dot as the badged assistant avatar.
 * The model the next answer runs on is in its accessible label and its hover tooltip:
 * "Select model: Terra" when chosen, "Select model: Use assistant model (Sol)" while
 * `selectedModel` is null and the assistant's own model applies.
 */
export default function ComposerModelButton({
    selectedModel,
    assistantModel,
    onSelectModel,
    position = DEFAULT_POSITION,
    getPopoverViewport,
    title,
    description,
    disabled = false,
    testID = 'composer-model-button',
}) {
    const dispatch = useDispatch()
    const [isOpen, setIsOpen] = useState(false)
    const unmounted = useRef(false)

    useEffect(() => {
        unmounted.current = false
        return () => {
            unmounted.current = true
        }
    }, [])

    // Only release the float-popup flag this button set, so unmounting a closed button (a project
    // switch, a resize into another layout) cannot close somebody else's popup.
    const openRef = useRef(false)
    useEffect(
        () => () => {
            if (openRef.current) dispatch(hideFloatPopup())
        },
        []
    )

    const open = () => {
        if (disabled) return
        openRef.current = true
        setIsOpen(true)
        dispatch(showFloatPopup())
    }

    const close = () => {
        openRef.current = false
        if (!unmounted.current) setIsOpen(false)
        dispatch(hideFloatPopup())
    }

    const pinnedName = getThreadAssistantModelName(selectedModel)
    // Resolved as the server resolves the assistant's model (a replaced key, no model at all).
    const assistantName = getAssistantDefaultModelName(assistantModel)
    const current = pinnedName
        ? pinnedName
        : assistantName
          ? translate('Use assistant model with name', { name: assistantName })
          : translate('Use assistant model')
    const accessibilityLabel = `${translate('Select model')}: ${current}`

    const PickerModal = isOpen ? getPickerModal() : null

    return (
        <AppPopover
            content={
                PickerModal ? (
                    <PickerModal
                        closeModal={close}
                        selectedModel={selectedModel}
                        assistantModel={assistantModel}
                        updateModel={onSelectModel}
                        title={title}
                        description={description}
                    />
                ) : null
            }
            align={'start'}
            position={position}
            getViewport={getPopoverViewport}
            onClickOutside={close}
            isOpen={isOpen}
            contentLocation={null}
            disableReposition
        >
            {/* The wrapper carries the hover tooltip: react-native-web does not forward `title`. */}
            <div className="composer-model-button" title={accessibilityLabel} style={WRAPPER_STYLE}>
                <TouchableOpacity
                    style={[localStyles.button, disabled && localStyles.disabled]}
                    onPress={open}
                    disabled={disabled}
                    accessibilityRole={'button'}
                    accessibilityLabel={accessibilityLabel}
                    accessibilityState={{ expanded: isOpen, disabled }}
                    testID={testID}
                >
                    <View style={localStyles.iconWrap}>
                        <Icon name="cpu" size={16} color={colors.Text03} />
                        {!!pinnedName && (
                            <View pointerEvents="none" testID={`${testID}-pinned`} style={localStyles.pinnedDot} />
                        )}
                    </View>
                </TouchableOpacity>
            </div>
        </AppPopover>
    )
}

const WRAPPER_STYLE = { display: 'flex', flexShrink: 0 }

const localStyles = StyleSheet.create({
    // AT-3162: icon only and borderless, like Templates once it drops its label, but a size
    // smaller, so it reads as a secondary control.
    button: {
        width: 32,
        height: 32,
        borderRadius: 16,
        alignItems: 'center',
        justifyContent: 'center',
    },
    disabled: {
        opacity: 0.5,
    },
    iconWrap: {
        position: 'relative',
    },
    pinnedDot: {
        position: 'absolute',
        right: -3,
        bottom: -2,
        width: 7,
        height: 7,
        borderRadius: 100,
        backgroundColor: colors.Primary100,
    },
})
