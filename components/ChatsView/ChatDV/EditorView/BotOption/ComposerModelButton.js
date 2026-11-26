import React, { useEffect, useRef, useState } from 'react'
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { useDispatch } from 'react-redux'

import AppPopover from '../../../../UIComponents/ModalShell/AppPopover'
import Icon from '../../../../Icon'
import styles, { colors } from '../../../../styles/global'
import { hideFloatPopup, showFloatPopup } from '../../../../../redux/actions'
import { translate } from '../../../../../i18n/TranslationService'
import { getThreadAssistantModelName } from '../../../../../functions/Assistant/threadAssistantModel'

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
 * `selectedModel` is null while the assistant's own model applies; the button then names that model,
 * so the user sees what the next answer runs on without opening the picker. A chosen model is
 * marked with the same dot as the badged assistant avatar.
 */
export default function ComposerModelButton({
    selectedModel,
    assistantModel,
    onSelectModel,
    compact = false,
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
    const name = pinnedName || getThreadAssistantModelName(assistantModel) || translate('Assistant default')
    const accessibilityLabel = `${translate('Select model')}: ${name}`

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
            <TouchableOpacity
                style={[localStyles.button, compact && localStyles.buttonCompact, disabled && localStyles.disabled]}
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
                {!compact && (
                    <Text style={[styles.subtitle2, localStyles.text]} numberOfLines={1}>
                        {name}
                    </Text>
                )}
            </TouchableOpacity>
        </AppPopover>
    )
}

const localStyles = StyleSheet.create({
    // Same pill as the Templates button beside it (AssistantTaskSearchButtonWrapper).
    button: {
        flexDirection: 'row',
        alignItems: 'center',
        height: 32,
        // react-native-web views do not shrink by default; this one gives way first in a narrow
        // toolbar, and its model name ellipsizes instead of pushing the send button out.
        flexShrink: 1,
        minWidth: 0,
        maxWidth: 180,
        paddingLeft: 10,
        paddingRight: 10,
        borderRadius: 16,
        borderWidth: 1,
        borderColor: colors.Grey300,
    },
    buttonCompact: {
        flexShrink: 0,
        width: 36,
        height: 36,
        paddingLeft: 0,
        paddingRight: 0,
        borderRadius: 18,
        borderWidth: 0,
        justifyContent: 'center',
    },
    disabled: {
        opacity: 0.5,
    },
    iconWrap: {
        position: 'relative',
        flexShrink: 0,
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
    text: {
        color: colors.Text02,
        marginLeft: 6,
        flexShrink: 1,
        minWidth: 0,
    },
})
