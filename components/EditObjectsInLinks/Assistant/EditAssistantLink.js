import React, { useState } from 'react'
import { cloneDeep } from 'lodash'
import { StyleSheet, View } from 'react-native'

import styles, { colors } from '../../styles/global'
import CustomTextInput3 from '../../Feeds/CommentsTextInput/CustomTextInput3'
import { CREATE_TASK_MODAL_THEME } from '../../Feeds/CommentsTextInput/textInputHelper'
import SaveButton from '../Common/SaveButton'
import OpenButton from '../../NewObjectsInMentions/Common/OpenButton'
import NavigationService from '../../../utils/NavigationService'
import { checkDVLink, getDvMainTabLink } from '../../../utils/LinkingHelper'
import URLTrigger from '../../../URLSystem/URLTrigger'
import { getPathname } from '../../Tags/LinkTag'
import { updateAssistant } from '../../../utils/backends/Assistants/assistantsFirestore'
import { useSelector } from 'react-redux'
import AssistantAvatar from '../../AdminPanel/Assistants/AssistantAvatar'

export default function EditAssistantLink({ projectId, assistantData, closeModal, objectUrl }) {
    const globalAssistants = useSelector(state => state.globalAssistants)
    const [assistant, setAssistant] = useState(cloneDeep(assistantData))

    const isGlobalAssistant = globalAssistants.some(assistant => assistant.uid === assistantData.uid)

    const assistantlHasValidChanges = () => {
        if (isGlobalAssistant) return false
        const cleanedName = assistant.displayName.trim()
        return cleanedName && cleanedName !== assistantData.displayName.trim()
    }

    const onChangeText = displayName => {
        setAssistant(assistant => ({ ...assistant, displayName }))
    }

    const update = updatedAssistant => {
        updateAssistant(projectId, updatedAssistant, assistantData)
        closeModal()
    }

    const updateCurrentChanges = () => {
        assistantlHasValidChanges() ? update({ ...assistant }) : closeModal()
    }

    const openDV = () => {
        closeModal()
        checkDVLink('assistant')
        const linkUrl =
            objectUrl != null ? getPathname(objectUrl) : getDvMainTabLink(projectId, assistantData.uid, 'assistants')
        URLTrigger.processUrl(NavigationService, linkUrl)
    }

    return (
        <View style={localStyles.container}>
            <View style={localStyles.inputContainer}>
                <AssistantAvatar
                    photoURL={assistant.photoURL50}
                    size={24}
                    assistantId={assistant.uid}
                    containerStyle={localStyles.icon}
                />
                <View style={localStyles.editorContainer}>
                    <CustomTextInput3
                        placeholder={'Type to edit the assistant'}
                        placeholderTextColor={colors.Text03}
                        onChangeText={onChangeText}
                        multiline={true}
                        externalTextStyle={localStyles.textInputText}
                        caretColor="white"
                        autoFocus={true}
                        initialTextExtended={assistant.displayName}
                        projectId={projectId}
                        styleTheme={CREATE_TASK_MODAL_THEME}
                        externalAlignment={{ paddingLeft: 0, paddingRight: 0 }}
                        forceTriggerEnterActionForBreakLines={updateCurrentChanges}
                        disabledEdition={isGlobalAssistant}
                    />
                </View>
            </View>
            <View style={localStyles.buttonsContainer}>
                <View style={localStyles.buttonsLeft}>
                    <OpenButton onPress={openDV} />
                </View>
                <SaveButton icon={assistantlHasValidChanges() ? 'save' : 'x'} onPress={updateCurrentChanges} />
            </View>
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        borderWidth: 1,
        borderColor: '#162764',
        borderRadius: 4,
    },
    inputContainer: {
        paddingTop: 2,
        paddingHorizontal: 16,
    },
    editorContainer: {
        marginTop: 2,
        marginBottom: 26,
        marginLeft: 28,
        minHeight: 38,
    },
    textInputText: {
        ...styles.body1,
        color: '#ffffff',
    },
    buttonsContainer: {
        flexDirection: 'row',
        backgroundColor: '#162764',
        paddingVertical: 8,
        paddingHorizontal: 8,
    },
    buttonsLeft: {
        flexDirection: 'row',
        flex: 1,
    },
    icon: {
        position: 'absolute',
        top: 8,
        left: 8,
    },
})
