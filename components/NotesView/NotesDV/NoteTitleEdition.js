import React, { useState } from 'react'
import { StyleSheet, View } from 'react-native'
import { useSelector } from 'react-redux'
import { Dismissible } from 'react-dismissible'
import { colors } from '../../styles/global'
import Button from '../../UIControls/Button'
import CustomTextInput3 from '../../Feeds/CommentsTextInput/CustomTextInput3'
import Backend from '../../../utils/BackendBridge'
import { translate } from '../../../i18n/TranslationService'

export default function NoteTitleEdition({
    projectId,
    note,
    onSubmit,
    closeTitleEdition,
    disableBacklinksGeneration,
    disabled,
}) {
    const showFloatPopup = useSelector(state => state.showFloatPopup)
    const [newExtendedTitle, setNewExtendedTitle] = useState(note.extendedTitle)

    const [linkedParentNotesUrl, setLinkedParentNotesUrl] = useState([])
    const [linkedParentTasksUrl, setLinkedParentTasksUrl] = useState([])
    const [linkedParentContactsUrl, setLinkedParentContactsUrl] = useState([])
    const [linkedParentProjectsUrl, setLinkedParentProjectsUrl] = useState([])
    const [linkedParentGoalsUrl, setLinkedParentGoalsUrl] = useState([])
    const [linkedParentSkillsUrl, setLinkedParentSkillsUrl] = useState([])
    const [linkedParentAssistantsUrl, setLinkedParentAssistantsUrl] = useState([])

    const onChangeText = (
        name,
        linkedParentNotesUrl,
        linkedParentTasksUrl,
        linkedParentContactsUrl,
        linkedParentProjectsUrl,
        linkedParentGoalsUrl,
        linkedParentSkillsUrl,
        linkedParentAssistantsUrl
    ) => {
        if (name !== '') {
            setLinkedParentNotesUrl(linkedParentNotesUrl)
            setLinkedParentTasksUrl(linkedParentTasksUrl)
            setLinkedParentContactsUrl(linkedParentContactsUrl)
            setLinkedParentProjectsUrl(linkedParentProjectsUrl)
            setLinkedParentGoalsUrl(linkedParentGoalsUrl)
            setLinkedParentSkillsUrl(linkedParentSkillsUrl)
            setLinkedParentAssistantsUrl(linkedParentAssistantsUrl)
        }
        setNewExtendedTitle(name)
    }

    const applyTitleChanges = () => {
        const cleanedName = newExtendedTitle.trim()
        if (cleanedName && cleanedName !== note.extendedTitle) {
            onSubmit(cleanedName)
            trySetLinkedObjects()
        }
        closeTitleEdition()
    }

    const trySetLinkedObjects = () => {
        if (!disableBacklinksGeneration) {
            Backend.setLinkedParentObjects(
                projectId,
                {
                    linkedParentNotesUrl,
                    linkedParentTasksUrl,
                    linkedParentContactsUrl,
                    linkedParentProjectsUrl,
                    linkedParentGoalsUrl,
                    linkedParentSkillsUrl,
                    linkedParentAssistantsUrl,
                },
                {
                    type: 'note',
                    id: note.id,
                    secondaryParentsIds: note.linkedParentsInContentIds,
                    notePartEdited: 'title',
                    isUpdatingNotes: true,
                },
                {}
            )
        }
    }

    const onInputKeyPress = key => {
        if (key === 'Enter') {
            applyTitleChanges()
        }
    }

    const cleanedName = newExtendedTitle.trim()
    const disabledSaveButton = !cleanedName || cleanedName === note.extendedTitle

    return (
        <View style={localStyles.container}>
            <View style={localStyles.textInputContainer}>
                <Dismissible disabled={showFloatPopup > 0} click={true} escape={true} onDismiss={closeTitleEdition}>
                    <CustomTextInput3
                        placeholder={translate('Write the name of the note')}
                        onChangeText={onChangeText}
                        initialTextExtended={newExtendedTitle}
                        containerStyle={localStyles.textInput}
                        projectId={projectId}
                        onKeyPress={onInputKeyPress}
                        forceTriggerEnterActionForBreakLines={applyTitleChanges}
                        disabledEdition={disabled}
                        autoFocus={true}
                    />
                </Dismissible>
            </View>
            <View style={localStyles.buttonsContainer}>
                <Button
                    type={'secondary'}
                    icon={'x'}
                    buttonStyle={localStyles.secondaryBtn}
                    onPress={closeTitleEdition}
                />
                <Button type={'primary'} icon={'save'} disabled={disabledSaveButton} onPress={applyTitleChanges} />
            </View>
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        flex: 1,
        flexDirection: 'row',
        marginTop: 28,
    },
    textInputContainer: {
        flex: 1,
        borderWidth: 2,
        borderRadius: 4,
        overflow: 'hidden',
        flexDirection: 'row',
        alignItems: 'center',
        borderColor: colors.UtilityBlue200,
    },
    textInput: {
        paddingHorizontal: 14,
        paddingTop: 0,
    },
    buttonsContainer: {
        flexDirection: 'row',
    },
    secondaryBtn: {
        marginLeft: 8,
        marginRight: 8,
    },
})
