import React, { useState, useEffect } from 'react'
import { StyleSheet, View } from 'react-native'
import { useSelector } from 'react-redux'
import { cloneDeep } from 'lodash'

import DoneButton from '../../GoalsView/EditGoalsComponents/DoneButton'
import CancelButton from '../../GoalsView/EditGoalsComponents/CancelButton'
import { translate } from '../../../i18n/TranslationService'
import CustomTextInput3 from '../../Feeds/CommentsTextInput/CustomTextInput3'
import Icon from '../../Icon'
import { GOAL_THEME } from '../../Feeds/CommentsTextInput/textInputHelper'
import { colors } from '../../styles/global'
import { getNewDefaultAssistant, openAssistantDv } from './assistantsHelper'
import { uploadNewAssistant } from '../../../utils/backends/Assistants/assistantsFirestore'

export default function EditAssistant({ projectId, adding, assistant, onCancelAction }) {
    const smallScreenNavigation = useSelector(state => state.smallScreenNavigation)
    const showFloatPopup = useSelector(state => state.showFloatPopup)
    const showGlobalSearchPopup = useSelector(state => state.showGlobalSearchPopup)
    const [tmpAssistant, setTmpAssistant] = useState(() => (adding ? getNewDefaultAssistant() : cloneDeep(assistant)))

    const assistantHasValidChanges = () => {
        const cleanedName = tmpAssistant.displayName.trim()
        return adding ? cleanedName !== '' : cleanedName !== '' && cleanedName !== assistant.displayName.trim()
    }

    const setName = displayName => {
        setTmpAssistant(tmpAssistant => {
            return { ...tmpAssistant, displayName }
        })
    }

    const hasChanges = assistantHasValidChanges()

    const actionDoneButton = () => {
        hasChanges
            ? adding
                ? createAssistant({ ...tmpAssistant })
                : updateAssistant({ ...tmpAssistant })
            : onCancelAction()
    }

    const createAssistant = async newAssistant => {
        const assistant = uploadNewAssistant(projectId, newAssistant, openDvWhenCreateAssistant)
        setTimeout(() => {
            onCancelAction()
        })
        return assistant
    }

    const updateAssistant = updatedAssistant => {
        setTimeout(() => {
            onCancelAction()
        })
    }

    const openDvWhenCreateAssistant = assistant => {
        openAssistantDv(projectId, assistant)
    }

    const enterKeyAction = () => {
        if (showFloatPopup === 0) actionDoneButton()
    }

    const onKeyDown = event => {
        const { key } = event
        if (key === 'Enter') {
            enterKeyAction()
        }
    }

    useEffect(() => {
        document.addEventListener('keydown', onKeyDown)
        return () => {
            return document.removeEventListener('keydown', onKeyDown)
        }
    })

    useEffect(() => {
        if (showGlobalSearchPopup) onCancelAction()
    }, [showGlobalSearchPopup])

    return (
        <View style={[localStyles.container, smallScreenNavigation ? localStyles.containerUnderBreakpoint : undefined]}>
            <View style={adding ? localStyles.inputContainerAdding : localStyles.inputContainer}>
                {adding && (
                    <Icon
                        style={[localStyles.icon, smallScreenNavigation && localStyles.iconMobile]}
                        name={'plus-square'}
                        size={24}
                        color={colors.Primary100}
                    />
                )}
                <CustomTextInput3
                    placeholder={translate(adding ? 'Type to add new assistant' : 'Write the name of the assistant')}
                    onChangeText={setName}
                    autoFocus={true}
                    containerStyle={[localStyles.textInputContainer, adding && localStyles.textInputContainerAdding]}
                    initialTextExtended={tmpAssistant.displayName}
                    styleTheme={GOAL_THEME}
                    forceTriggerEnterActionForBreakLines={enterKeyAction}
                    disabledTags={true}
                />
            </View>
            <View style={localStyles.buttonContainer}>
                <View style={[localStyles.buttonSection, localStyles.buttonSectionRight]}>
                    <CancelButton onCancelAction={onCancelAction} />
                    <DoneButton needUpdate={hasChanges} adding={adding} actionDoneButton={actionDoneButton} />
                </View>
            </View>
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: '#ffffff',
        borderWidth: 1,
        borderStyle: 'solid',
        borderColor: colors.Grey200,
        borderRadius: 4,
        shadowColor: 'rgba(0,0,0,0.08)',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 1,
        shadowRadius: 8,
        elevation: 3,
        marginLeft: -6,
        marginRight: -6,
        marginBottom: 16,
    },
    containerUnderBreakpoint: {
        marginLeft: -8,
        marginRight: -8,
    },
    buttonContainer: {
        flex: 1,
        flexDirection: 'row',
        backgroundColor: colors.Grey100,
        borderTopWidth: 1,
        borderStyle: 'solid',
        borderTopColor: colors.Gray300,
        paddingVertical: 7,
        paddingHorizontal: 9,
    },
    buttonSection: {
        flexDirection: 'row',
        flexGrow: 1,
    },
    buttonSectionRight: {
        justifyContent: 'flex-end',
    },
    inputContainerAdding: {
        paddingHorizontal: 6,
        overflow: 'hidden',
        flexDirection: 'row',
    },
    inputContainer: {
        paddingLeft: 19,
        paddingRight: 6,
        paddingTop: 3.5,
        overflow: 'hidden',
        flexDirection: 'row',
    },
    icon: {
        marginLeft: 7,
        marginTop: 15,
    },
    iconMobile: {
        marginLeft: 9,
    },
    textInputContainerAdding: {
        marginLeft: 12,
        marginTop: 10,
        minHeight: 56,
    },
    textInputContainer: {
        borderTopLeftRadius: 4,
        borderTopRightRadius: 4,
        minHeight: 44.5,
        marginTop: 3.5,
        marginBottom: 8,
    },
})
