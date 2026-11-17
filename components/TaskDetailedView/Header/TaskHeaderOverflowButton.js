import React, { useEffect, useRef, useState } from 'react'
import { StyleSheet, TouchableOpacity } from 'react-native'
import { useSelector } from 'react-redux'

import AppPopover from '../../UIComponents/ModalShell/AppPopover'
import Icon from '../../Icon'
import { colors } from '../../styles/global'
import { translate } from '../../../i18n/TranslationService'
import useFloatPopupLock from '../../../hooks/useFloatPopupLock'
import TaskHeaderOverflowModal from './TaskHeaderOverflowModal'

/**
 * "⋯" trigger for the task header's secondary actions (AT-3081). Same 32px bordered square as the
 * header's other icon buttons, and the same open/close and float-popup bookkeeping as `PrivacyTag`,
 * because the visibility picker can now be reached through this menu as well.
 */
export default function TaskHeaderOverflowButton({
    projectId,
    task,
    showVisibility,
    visibilityDisabled,
    canSearch,
    style,
}) {
    const smallScreenNavigation = useSelector(state => state.smallScreenNavigation)
    const [open, setOpen] = useState(false)
    const isUnmountedRef = useRef(false)
    const hideTimeoutRef = useRef(null)
    const popupLock = useFloatPopupLock()

    useEffect(() => {
        return () => {
            isUnmountedRef.current = true
            if (hideTimeoutRef.current) {
                clearTimeout(hideTimeoutRef.current)
                hideTimeoutRef.current = null
            }
        }
    }, [])

    const closeMenu = () => {
        if (isUnmountedRef.current) return
        setOpen(false)
        popupLock.release()
    }

    // The visibility picker closes itself from inside its own click handlers; deferring lets that
    // click finish before the popover (and the picker in it) unmounts, as `PrivacyTag` does.
    const delayCloseMenu = event => {
        if (event) {
            event.preventDefault?.()
            event.stopPropagation?.()
        }
        hideTimeoutRef.current = setTimeout(() => {
            hideTimeoutRef.current = null
            closeMenu()
        })
    }

    const toggleMenu = () => {
        if (open) {
            closeMenu()
            return
        }
        if (hideTimeoutRef.current) {
            clearTimeout(hideTimeoutRef.current)
            hideTimeoutRef.current = null
        }
        setOpen(true)
        popupLock.acquire()
    }

    return (
        <AppPopover
            content={
                open ? (
                    <TaskHeaderOverflowModal
                        projectId={projectId}
                        task={task}
                        showVisibility={showVisibility}
                        visibilityDisabled={visibilityDisabled}
                        canSearch={canSearch}
                        closeModal={closeMenu}
                        delayCloseModal={delayCloseMenu}
                    />
                ) : null
            }
            onClickOutside={delayCloseMenu}
            isOpen={open}
            position={['bottom', 'left', 'right', 'top']}
            padding={4}
            align={'end'}
            contentLocation={smallScreenNavigation ? null : undefined}
        >
            <TouchableOpacity
                testID="task-header-overflow-button"
                onPress={toggleMenu}
                style={[localStyles.container, style]}
                accessibilityRole="button"
                accessibilityLabel={translate('More options')}
                accessibilityState={{ expanded: open }}
            >
                <Icon name={'more-horizontal'} size={18} color={colors.Text03} />
            </TouchableOpacity>
        </AppPopover>
    )
}

const localStyles = StyleSheet.create({
    container: {
        maxHeight: 32,
        minHeight: 32,
        minWidth: 32,
        borderWidth: 1,
        borderRadius: 4,
        flexDirection: 'row',
        backgroundColor: 'transparent',
        borderColor: colors.Gray400,
        alignItems: 'center',
        justifyContent: 'center',
        paddingVertical: 7,
        paddingHorizontal: 7,
    },
})
