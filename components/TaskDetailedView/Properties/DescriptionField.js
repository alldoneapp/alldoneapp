import React, { useEffect, useRef, useState } from 'react'
import { Keyboard, StyleSheet, Text, View } from 'react-native'
import CustomTextInput3 from '../../Feeds/CommentsTextInput/CustomTextInput3'
import { insertAttachmentInsideEditor, TASK_THEME } from '../../Feeds/CommentsTextInput/textInputHelper'
import styles, { colors } from '../../styles/global'
import Button from '../../UIControls/Button'
import { useSelector } from 'react-redux'
import AddFeedAttachButton from '../../Feeds/AddFeed/AddFeedAttachButton'
import { updateNewAttachmentsData } from '../../Feeds/Utils/HelperFunctions'
import Backend from '../../../utils/BackendBridge'
import {
    FEED_TASK_OBJECT_TYPE,
    FEED_GOAL_OBJECT_TYPE,
    FEED_PROJECT_OBJECT_TYPE,
    FEED_SKILL_OBJECT_TYPE,
    FEED_ASSISTANT_OBJECT_TYPE,
} from '../../Feeds/Utils/FeedsConstants'
import { translate } from '../../../i18n/TranslationService'
import { exitsOpenModals } from '../../ModalsManager/modalsManager'
import { updateAssistantDescription } from '../../../utils/backends/Assistants/assistantsFirestore'
import { setTaskDescription } from '../../../utils/backends/Tasks/tasksFirestore'

export default function DescriptionField({ projectId, object, disabled, objectType, isCalendarTask }) {
    const blockShortcuts = useSelector(state => state.blockShortcuts)
    const smallScreen = useSelector(state => state.smallScreen)
    const [description, setDescription] = useState(object.description)
    const [inputCursorIndex, setInputCursorIndex] = useState(0)
    const [editor, setEditor] = useState(null)
    const [mentionsModalActive, setMentionsModalActive] = useState(false)
    const inputRef = useRef()

    const updateDescription = () => {
        updateNewAttachmentsData(projectId, description).then(finalDescription => {
            if (objectType === FEED_TASK_OBJECT_TYPE) {
                setTaskDescription(projectId, object.id, finalDescription, object, object.description)
            } else if (objectType === FEED_GOAL_OBJECT_TYPE) {
                Backend.setGoalDescription(projectId, object.id, finalDescription, object, object.description)
            } else if (objectType === FEED_PROJECT_OBJECT_TYPE) {
                Backend.setProjectDescription(projectId, finalDescription, object, object.description)
            } else if (objectType === FEED_SKILL_OBJECT_TYPE) {
                Backend.updateSkillDescription(projectId, object, finalDescription)
            } else if (objectType === FEED_ASSISTANT_OBJECT_TYPE) {
                updateAssistantDescription(projectId, finalDescription, object)
            }
        })
    }

    const addAttachmentTag = (text, uri) => {
        insertAttachmentInsideEditor(inputCursorIndex, editor, text, uri)
    }

    const onkeydown = e => {
        if (
            e.key === 'Enter' &&
            !mentionsModalActive &&
            !e.shiftKey &&
            !exitsOpenModals() &&
            inputRef.current.isFocused()
        ) {
            updateDescription()
        }
    }

    useEffect(() => {
        inputRef?.current?.blur()
        Keyboard.dismiss()
    }, [])

    useEffect(() => {
        if (blockShortcuts) {
            return
        }
        document.addEventListener('keydown', onkeydown)
        return () => document.removeEventListener('keydown', onkeydown)
    })

    const getPlaceholder = () => {
        let type = ''
        if (objectType === FEED_TASK_OBJECT_TYPE) {
            type = 'task'
        } else if (objectType === FEED_GOAL_OBJECT_TYPE) {
            type = 'goal'
        } else if (objectType === FEED_PROJECT_OBJECT_TYPE) {
            type = 'project'
        } else if (objectType === FEED_SKILL_OBJECT_TYPE) {
            type = 'skill'
        } else if (objectType === FEED_ASSISTANT_OBJECT_TYPE) {
            type = 'assistant'
        }
        return translate(`Type the ${type} description here`)
    }

    return (
        <View style={localStyles.container}>
            <Text style={localStyles.header}>{translate('Description')}</Text>
            <View style={localStyles.inputContainer}>
                <CustomTextInput3
                    ref={inputRef}
                    placeholder={getPlaceholder()}
                    placeholderTextColor={colors.Text03}
                    onChangeText={setDescription}
                    multiline={true}
                    externalTextStyle={localStyles.textInputText}
                    externalAlignment={{ paddingLeft: 0, paddingRight: 0 }}
                    setMentionsModalActive={setMentionsModalActive}
                    initialTextExtended={description}
                    projectId={projectId}
                    styleTheme={TASK_THEME}
                    setInputCursorIndex={setInputCursorIndex}
                    initialCursorIndex={inputCursorIndex}
                    disabledEdition={disabled}
                    setEditor={setEditor}
                    otherFormats={['image', 'attachment', 'customImageFormat', 'videoFormat']}
                    isCalendarTask={isCalendarTask}
                />
            </View>

            {!disabled && (
                <View style={localStyles.buttonsContainer}>
                    <View>
                        <AddFeedAttachButton
                            subscribeClickObserver={() => {}}
                            unsubscribeClickObserver={() => {}}
                            smallScreen={smallScreen}
                            addAttachmentTag={addAttachmentTag}
                            projectId={projectId}
                        />
                    </View>
                    <View>
                        <Button
                            title={smallScreen ? null : object.description !== description ? translate(`Save`) : 'Ok'}
                            type={'primary'}
                            icon={smallScreen ? (object.description !== description ? 'save' : 'x') : null}
                            onPress={updateDescription}
                            accessible={false}
                            shortcutText={'Enter'}
                        />
                    </View>
                </View>
            )}
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        marginTop: 16,
        marginBottom: 56,
    },
    header: {
        ...styles.subtitle2,
        color: colors.Text02,
        marginBottom: 4,
    },
    inputContainer: {
        borderWidth: 1,
        borderColor: colors.Grey400,
        borderRadius: 4,
        marginBottom: 8,
        minHeight: 120,
        paddingVertical: 8,
        paddingHorizontal: 16,
    },
    textInputText: {
        ...styles.body1,
        color: colors.Text01,
    },
    buttonsContainer: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
    },
})
