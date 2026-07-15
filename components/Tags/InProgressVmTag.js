import React, { useEffect, useState } from 'react'
import { StyleSheet, Text, View } from 'react-native'

import styles, { colors, windowTagStyle } from '../styles/global'
import {
    getVmSessionBadgeState,
    VM_BADGE_STATE_FAILED,
    VM_BADGE_STATE_IN_PROGRESS,
    VM_BADGE_STATE_PAUSED,
    watchVmSessionStatus,
} from '../../utils/backends/Assistants/vmSessionStatus'

export const IN_PROGRESS_VM_LABEL = 'In progress VM'
export const PAUSED_VM_LABEL = 'Paused VM'
export const FAILED_VM_LABEL = 'Failed VM'

const BADGE_PRESENTATION = {
    [VM_BADGE_STATE_IN_PROGRESS]: {
        label: IN_PROGRESS_VM_LABEL,
        containerStyle: 'inProgressContainer',
        textStyle: 'inProgressText',
    },
    [VM_BADGE_STATE_PAUSED]: {
        label: PAUSED_VM_LABEL,
        containerStyle: 'pausedContainer',
        textStyle: 'pausedText',
    },
    [VM_BADGE_STATE_FAILED]: {
        label: FAILED_VM_LABEL,
        containerStyle: 'failedContainer',
        textStyle: 'failedText',
    },
}

export function VmStatusTag({ session, status, style }) {
    const badgeState = getVmSessionBadgeState(session || status)
    const presentation = BADGE_PRESENTATION[badgeState]
    if (!presentation) return null

    return (
        <View
            accessibilityLabel={presentation.label}
            style={[localStyles.container, localStyles[presentation.containerStyle], style]}
        >
            <Text style={[styles.subtitle2, localStyles[presentation.textStyle], windowTagStyle()]}>
                {presentation.label}
            </Text>
        </View>
    )
}

export default function TaskVmStatusTag({ projectId, taskId, style }) {
    const [session, setSession] = useState(null)

    useEffect(() => {
        setSession(null)
        return watchVmSessionStatus(projectId, taskId, setSession)
    }, [projectId, taskId])

    return <VmStatusTag session={session} style={style} />
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
    inProgressContainer: {
        backgroundColor: colors.UtilityYellow125,
    },
    inProgressText: {
        color: colors.Yellow400,
    },
    pausedContainer: {
        backgroundColor: colors.Gray300,
    },
    pausedText: {
        color: colors.Text03,
    },
    failedContainer: {
        backgroundColor: colors.UtilityRed100,
    },
    failedText: {
        color: colors.UtilityRed300,
    },
})
