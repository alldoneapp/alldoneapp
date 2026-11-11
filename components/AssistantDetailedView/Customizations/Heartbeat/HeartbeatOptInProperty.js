import React, { useEffect, useState } from 'react'
import { StyleSheet, Text, View, TouchableOpacity } from 'react-native'

import styles, { colors } from '../../../styles/global'
import Icon from '../../../Icon'
import {
    getAssistantHeartbeatOptIn,
    setAssistantHeartbeatOptIn,
} from '../../../../utils/backends/Assistants/assistantsFirestore'
import { translate } from '../../../../i18n/TranslationService'

import { themed } from '../../../../Themes/colorMode'

// A heartbeat runs as the member it is for: with their Gold and their connected accounts. It
// therefore runs for a member only after they confirmed the assistant's current heartbeat prompt,
// tools, instructions and MCP servers, and it stops for them when somebody else changes one of those
// (functions/Assistant/heartbeatOptIn.js, security audit NV-17). The server confirms on its own for
// the only member of a project, so this row matters in shared projects.
// The state is the server's answer; the hash it is compared with is never computed here.
export default function HeartbeatOptInProperty({ projectId, assistant }) {
    const [state, setState] = useState(null)
    const [saving, setSaving] = useState(false)
    const assistantId = assistant.uid
    const configKey = JSON.stringify([
        assistant.heartbeatPrompt ?? null,
        assistant.allowedTools ?? null,
        assistant.instructions ?? null,
        assistant.mcpServers ?? null,
    ])

    useEffect(() => {
        let cancelled = false
        getAssistantHeartbeatOptIn(projectId, assistantId)
            .then(result => !cancelled && setState(result?.state || 'none'))
            .catch(() => !cancelled && setState('unknown'))
        return () => {
            cancelled = true
        }
    }, [projectId, assistantId, configKey])

    if (state === null || state === 'unknown') return null

    const checked = state === 'confirmed'

    const toggle = () => {
        if (saving) return
        setSaving(true)
        setAssistantHeartbeatOptIn(projectId, assistantId, !checked)
            .then(result => setState(result?.state || 'none'))
            .catch(() => {})
            .finally(() => setSaving(false))
    }

    const caption = state === 'stale' ? translate('heartbeatOptInStale') : translate('heartbeatOptInExplanation')

    return (
        <View style={localStyles.container}>
            <View style={localStyles.settingRow}>
                <View style={[localStyles.settingRowSection, localStyles.settingRowLeft]}>
                    <Icon name={'user-check'} size={24} color={colors.Text03} style={{ marginHorizontal: 8 }} />
                    <Text style={[styles.subtitle2, { color: colors.Text03 }]} numberOfLines={1}>
                        {translate('Run heartbeat for me')}
                    </Text>
                </View>
                <View style={[localStyles.settingRowSection, localStyles.settingRowRight]}>
                    <TouchableOpacity
                        accessibilityRole="checkbox"
                        accessibilityState={{ checked, disabled: saving }}
                        style={[localStyles.checkboxContainer, checked && localStyles.checkboxActive]}
                        onPress={toggle}
                        disabled={saving}
                        activeOpacity={0.8}
                    >
                        {checked && <Icon name="check" size={14} color={colors.Primary200} />}
                    </TouchableOpacity>
                </View>
            </View>
            <Text style={[styles.caption2, localStyles.caption, state === 'stale' && localStyles.captionWarning]}>
                {caption}
            </Text>
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        paddingBottom: 8,
    },
    settingRow: {
        height: 56,
        justifyContent: 'space-between',
        alignItems: 'center',
        flexDirection: 'row',
    },
    settingRowSection: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    settingRowLeft: {
        flex: 1,
        justifyContent: 'flex-start',
    },
    settingRowRight: {
        justifyContent: 'flex-end',
    },
    caption: {
        color: colors.Text03,
        marginLeft: 40,
    },
    captionWarning: {
        color: colors.UtilityRed200,
    },
    checkboxContainer: {
        width: 24,
        height: 24,
        borderRadius: 4,
        borderWidth: 1,
        borderColor: colors.Grey400,
        backgroundColor: themed.Surface,
        alignItems: 'center',
        justifyContent: 'center',
    },
    checkboxActive: {
        backgroundColor: colors.Grey100,
        borderColor: colors.Primary200,
    },
})
