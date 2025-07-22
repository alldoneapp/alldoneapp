import React, { useEffect, useState } from 'react'
import { StyleSheet, View } from 'react-native'
import { useDispatch } from 'react-redux'

import styles, { colors } from '../../../styles/global'
import CustomTextInput3 from '../../../Feeds/CommentsTextInput/CustomTextInput3'
import { CREATE_TASK_MODAL_THEME } from '../../../Feeds/CommentsTextInput/textInputHelper'
import Icon from '../../../Icon'
import { translate } from '../../../../i18n/TranslationService'
import Button from '../../../UIControls/Button'
import {
    setAssistantLastVisitedBoardDate,
    uploadNewAssistant,
} from '../../../../utils/backends/Assistants/assistantsFirestore'
import { getNewDefaultAssistant } from '../../../AdminPanel/Assistants/assistantsHelper'
import { DV_TAB_ROOT_TASKS } from '../../../../utils/TabNavigationConstants'
import {
    setSelectedSidebarTab,
    setSelectedTypeOfProject,
    setTaskViewToggleIndex,
    setTaskViewToggleSection,
    storeCurrentShortcutUser,
    storeCurrentUser,
} from '../../../../redux/actions'
import ProjectHelper from '../../../SettingsView/ProjectsSettings/ProjectHelper'
import store from '../../../../redux/store'
import NavigationService from '../../../../utils/NavigationService'

export default function CreateAssistant({ inputRef, projectId, closeModal, closeInput }) {
    const dispatch = useDispatch()
    const [tmpAssistant, setTmpAssistant] = useState(getNewDefaultAssistant())

    useEffect(() => {
        inputRef?.current?.focus()
    }, [])

    const addNewAssistant = () => {
        uploadNewAssistant(projectId, tmpAssistant, openDvWhenCreateAssistant)
        closeModal()
    }

    const openDvWhenCreateAssistant = assistant => {
        const { loggedUser } = store.getState()

        NavigationService.navigate('Root')

        setAssistantLastVisitedBoardDate(projectId, assistant, projectId, 'lastVisitBoard')

        const projectType = ProjectHelper.getTypeOfProject(loggedUser, projectId)

        dispatch([
            setSelectedSidebarTab(DV_TAB_ROOT_TASKS),
            storeCurrentUser(assistant),
            setSelectedTypeOfProject(projectType),
            storeCurrentShortcutUser(null),
            setTaskViewToggleIndex(0),
            setTaskViewToggleSection('Open'),
        ])
    }

    const assistantHasValidChanges = () => {
        return tmpAssistant.displayName.trim() !== ''
    }

    const setName = displayName => {
        setTmpAssistant(tmpAssistant => {
            return { ...tmpAssistant, displayName }
        })
    }

    const onKeyDown = e => {
        if (inputRef?.current?.isFocused()) {
            if (e.key === 'Escape') {
                e?.preventDefault()
                e?.stopPropagation()
                closeInput()
            } else if (e.key === 'Enter' && hasChanges) {
                e?.preventDefault()
                e?.stopPropagation()
                addNewAssistant()
            }
        }
    }

    useEffect(() => {
        document.addEventListener('keydown', onKeyDown)
        return () => document.removeEventListener('keydown', onKeyDown)
    })

    const hasChanges = assistantHasValidChanges()

    return (
        <View style={localStyles.container}>
            <View style={localStyles.inputContainer}>
                <Icon name={'plus-square'} size={24} color={colors.Primary100} style={localStyles.icon} />
                <View style={{ marginTop: 2, marginBottom: 26, marginLeft: 28, minHeight: 38 }}>
                    <CustomTextInput3
                        ref={inputRef}
                        placeholder={translate('Type to add new assistant')}
                        placeholderTextColor={colors.Text03}
                        onChangeText={setName}
                        externalTextStyle={localStyles.textInputText}
                        caretColor="white"
                        autoFocus={true}
                        disabledTags={true}
                        styleTheme={CREATE_TASK_MODAL_THEME}
                        externalAlignment={{ paddingLeft: 0, paddingRight: 0 }}
                        disabledEnterKey={true}
                        singleLine={true}
                    />
                </View>
            </View>
            <View style={localStyles.buttonsContainer}>
                <View style={localStyles.buttonsLeft}>
                    <View />
                </View>
                <View style={localStyles.buttonsRight}>
                    <Button
                        icon={hasChanges ? 'plus' : 'x'}
                        iconColor={'#ffffff'}
                        type={'primary'}
                        onPress={hasChanges ? addNewAssistant : closeInput}
                        shortcutText={'Enter'}
                        forceShowShortcut={true}
                    />
                </View>
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
