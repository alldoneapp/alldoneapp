import React, { useEffect, useRef, useState } from 'react'
import { StyleSheet, Text, TouchableOpacity } from 'react-native'
import { useDispatch } from 'react-redux'

import AppPopover from '../../../../UIComponents/ModalShell/AppPopover'
import AssistantTaskSearchModal from './AssistantTaskSearchModal'
import Icon from '../../../../Icon'
import styles, { colors } from '../../../../styles/global'
import { hideFloatPopup, showFloatPopup } from '../../../../../redux/actions'
import { translate } from '../../../../../i18n/TranslationService'

/**
 * "Templates" in the assistant line's toolbar: the single way into the pre-configured tasks of
 * every assistant in every project. It replaced the row of per-assistant task chips, the
 * Search pill and the More toggle. The tasks of the assistant the line is talking to are listed
 * first (`preferredAssistantId` / `preferredProjectId`).
 */
export default function AssistantTaskSearchButtonWrapper({ preferredAssistantId, preferredProjectId, compact }) {
    const dispatch = useDispatch()
    const [isOpen, setIsOpen] = useState(false)
    const isUnmountedRef = useRef(false)

    useEffect(() => {
        return () => {
            isUnmountedRef.current = true
            dispatch(hideFloatPopup())
        }
    }, [])

    const safeSetIsOpen = value => {
        if (!isUnmountedRef.current) setIsOpen(value)
    }

    const openModal = () => {
        safeSetIsOpen(true)
        dispatch(showFloatPopup())
    }

    const closeModal = () => {
        safeSetIsOpen(false)
        dispatch(hideFloatPopup())
    }

    const label = translate('Templates')

    return (
        <AppPopover
            // The modal queries assistant tasks across every project. Keep it
            // out of the closed popover tree instead of relying on every
            // popover presenter to suppress closed content.
            content={
                isOpen ? (
                    <AssistantTaskSearchModal
                        closeModal={closeModal}
                        preferredAssistantId={preferredAssistantId}
                        preferredProjectId={preferredProjectId}
                    />
                ) : null
            }
            align={'start'}
            position={['bottom', 'top', 'left', 'right']}
            onClickOutside={closeModal}
            isOpen={isOpen}
            contentLocation={null}
            disableReposition
        >
            <TouchableOpacity
                style={[localStyles.button, compact && localStyles.buttonCompact]}
                onPress={openModal}
                accessibilityRole={'button'}
                accessibilityLabel={label}
                accessibilityState={{ expanded: isOpen }}
                testID="assistant-task-search-button"
            >
                <Icon name="search" size={16} color={colors.Text03} />
                {!compact && <Text style={[styles.subtitle2, localStyles.text]}>{label}</Text>}
                {!compact && <Icon name="chevron-down" size={16} color={colors.Text03} />}
            </TouchableOpacity>
        </AppPopover>
    )
}

const localStyles = StyleSheet.create({
    button: {
        flexDirection: 'row',
        alignItems: 'center',
        height: 32,
        paddingLeft: 10,
        paddingRight: 8,
        borderRadius: 16,
        borderWidth: 1,
        borderColor: colors.Grey300,
    },
    buttonCompact: {
        width: 36,
        height: 36,
        paddingLeft: 0,
        paddingRight: 0,
        borderRadius: 18,
        borderWidth: 0,
        justifyContent: 'center',
    },
    text: {
        color: colors.Text02,
        marginLeft: 6,
        marginRight: 2,
    },
})
