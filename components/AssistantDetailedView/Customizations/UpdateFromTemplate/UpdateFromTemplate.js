import React from 'react'
import { StyleSheet, View } from 'react-native'

import Button from '../../../UIControls/Button'
import { translate } from '../../../../i18n/TranslationService'
import {
    updateAssistantFromTemplate,
    syncPreConfigTasksFromTemplate,
} from '../../../../utils/backends/Assistants/assistantsFirestore'
import { useUpdateAvailable } from './useUpdateAvailable'

export default function UpdateFromTemplate({ projectId, assistant, disabled }) {
    const { isAvailable, globalAssistant } = useUpdateAvailable(assistant)

    const handleUpdate = async () => {
        if (!globalAssistant) return

        // Update assistant properties from template
        await updateAssistantFromTemplate(projectId, assistant, globalAssistant)

        // Sync pre-configured tasks from template
        await syncPreConfigTasksFromTemplate(globalAssistant.uid, projectId, assistant.uid)
    }

    // Only show button when update is available
    if (!isAvailable) {
        return null
    }

    return (
        <View style={localStyles.container}>
            <Button
                type={'ghost'}
                icon={'refresh-cw'}
                onPress={handleUpdate}
                disabled={disabled}
                title={translate('Update from template')}
            />
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        marginLeft: 8,
    },
})
