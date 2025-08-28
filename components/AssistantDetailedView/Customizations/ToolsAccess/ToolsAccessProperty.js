import React, { useMemo } from 'react'
import { View, Text, TouchableOpacity } from 'react-native'
import { useSelector } from 'react-redux'

import CheckBox from '../../../CheckBox'
import { translate } from '../../../../i18n/TranslationService'
import { updateAssistant } from '../../../../utils/backends/Assistants/assistantsFirestore'

export default function ToolsAccessProperty({ disabled, projectId, assistant }) {
    const loggedUser = useSelector(state => state.loggedUser)

    const availableTools = useMemo(
        () => [
            { key: 'create_task', label: translate('Create new task') },
            { key: 'get_tasks', label: translate('Get tasks') },
        ],
        []
    )

    const allowedTools = Array.isArray(assistant.allowedTools) ? assistant.allowedTools : []

    const toggleTool = key => {
        if (disabled) return
        const next = allowedTools.includes(key) ? allowedTools.filter(t => t !== key) : [...allowedTools, key]
        updateAssistant(projectId, { ...assistant, allowedTools: next }, assistant)
    }

    return (
        <View style={{ marginTop: 12 }}>
            {availableTools.map(tool => (
                <TouchableOpacity
                    key={tool.key}
                    style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 8 }}
                    onPress={() => toggleTool(tool.key)}
                    disabled={disabled}
                >
                    <CheckBox checked={allowedTools.includes(tool.key)} />
                    <Text style={{ marginLeft: 8, opacity: disabled ? 0.6 : 1 }}>
                        {`${translate('Allow tool')}: ${tool.label}`}
                    </Text>
                </TouchableOpacity>
            ))}
        </View>
    )
}
