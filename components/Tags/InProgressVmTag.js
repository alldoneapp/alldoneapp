import React, { useEffect, useState } from 'react'
import { StyleSheet, Text, View } from 'react-native'

import styles, { colors, windowTagStyle } from '../styles/global'
import { isVmSessionActiveOrWarm, watchVmSessionStatus } from '../../utils/backends/Assistants/vmSessionStatus'

export const IN_PROGRESS_VM_LABEL = 'In progress VM'

export function InProgressVmTag({ status, style }) {
    if (!isVmSessionActiveOrWarm(status)) return null

    return (
        <View accessibilityLabel={IN_PROGRESS_VM_LABEL} style={[localStyles.container, style]}>
            <Text style={[styles.subtitle2, localStyles.text, windowTagStyle()]}>{IN_PROGRESS_VM_LABEL}</Text>
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
        backgroundColor: colors.UtilityYellow125,
        borderRadius: 12,
        flexDirection: 'row',
        height: 24,
        justifyContent: 'center',
        paddingHorizontal: 8,
    },
    text: {
        color: colors.Yellow400,
    },
})
