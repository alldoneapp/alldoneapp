import React, { useState } from 'react'
import { StyleSheet, Text, TouchableOpacity } from 'react-native'
import { useSelector } from 'react-redux'

import AppPopover from '../UIComponents/ModalShell/AppPopover'
import FocusAreaPicker from '../GoalsView/FocusAreaPicker'
import styles, { colors } from '../styles/global'
import { translate } from '../../i18n/TranslationService'
import useFloatPopupLock from '../../hooks/useFloatPopupLock'
import { getGoalFocusArea } from '../../functions/shared/goalFocusAreas'
import { setGoalFocusArea } from '../../utils/backends/Goals/goalFocusAreas'

export default function GoalFocusAreaTag({ projectId, goal, onChange, showEmpty = false, disabled, style }) {
    const popupLock = useFloatPopupLock()
    const catalog = useSelector(state => state.loggedUserProjectsMap?.[projectId]?.focusAreas)
    const [open, setOpen] = useState(false)
    const area = getGoalFocusArea(goal, catalog)

    const close = () => {
        setOpen(false)
        popupLock.release()
    }

    if (!area && !showEmpty && !open) return null

    return (
        <AppPopover
            isOpen={open}
            content={
                <FocusAreaPicker
                    projectId={projectId}
                    selectedId={goal.focusAreaId}
                    onChange={onChange || (id => setGoalFocusArea(projectId, goal.id, id))}
                    onClose={close}
                />
            }
            onClickOutside={close}
            position={['bottom', 'top', 'left', 'right']}
            align="end"
            padding={4}
        >
            <TouchableOpacity
                accessibilityRole="button"
                disabled={disabled}
                accessibilityLabel={`${translate('Focus area')}: ${area?.name || translate('None (General)')}`}
                onPress={() => {
                    if (popupLock.isAcquired()) return
                    setOpen(true)
                    popupLock.acquire()
                }}
                style={[localStyles.container, style]}
            >
                <Text numberOfLines={1} style={localStyles.text}>
                    {area?.name || translate('None (General)')}
                </Text>
            </TouchableOpacity>
        </AppPopover>
    )
}

const localStyles = StyleSheet.create({
    container: {
        minHeight: 24,
        maxWidth: 180,
        borderRadius: 12,
        backgroundColor: colors.Grey300,
        paddingHorizontal: 8,
        justifyContent: 'center',
    },
    text: { ...styles.subtitle2, color: colors.Text03 },
})
