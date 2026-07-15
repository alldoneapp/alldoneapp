import React, { useEffect, useState } from 'react'
import { StyleSheet, Text, View } from 'react-native'

import styles, { colors, windowTagStyle } from '../styles/global'
import {
    getVmSessionBadgeState,
    VM_SESSION_BADGE_ACTIVE,
    watchVmSessionStatus,
} from '../../utils/backends/Assistants/vmSessionStatus'

export const IN_PROGRESS_VM_LABEL = 'In progress VM'
export const PAUSED_VM_LABEL = 'Paused VM'

export function InProgressVmTag({ status, style }) {
    const badgeState = getVmSessionBadgeState(status)
    if (!badgeState) return null

    const isActive = badgeState === VM_SESSION_BADGE_ACTIVE
    const label = isActive ? IN_PROGRESS_VM_LABEL : PAUSED_VM_LABEL

    return (
        <View
            accessibilityLabel={label}
            style={[localStyles.container, isActive ? localStyles.activeContainer : localStyles.pausedContainer, style]}
        >
            <Text
                style={[styles.subtitle2, isActive ? localStyles.activeText : localStyles.pausedText, windowTagStyle()]}
            >
                {label}
            </Text>
        </View>
    )
}

export default function TaskVmStatusTag({ projectId, taskId, style }) {
    const [status, setStatus] = useState(null)

    useEffect(() => {
        setStatus(null)
        return watchVmSessionStatus(projectId, taskId, setStatus)
    }, [projectId, taskId])

    return <InProgressVmTag status={status} style={style} />
}

const localStyles = StyleSheet.create({
    container: {
        alignItems: 'center',
        borderRadius: 12,
        flexDirection: 'row',
        height: 24,
        justifyContent: 'center',
        paddingHorizontal: 8,
    },
    activeContainer: {
        backgroundColor: colors.UtilityYellow125,
    },
    activeText: {
        color: colors.Yellow400,
    },
    pausedContainer: {
        backgroundColor: colors.Gray300,
    },
    pausedText: {
        color: colors.Text03,
    },
})
