import React, { useEffect, useRef, useState } from 'react'
import { Keyboard, StyleSheet, Text, View } from 'react-native'
import CustomTextInput3 from '../../Feeds/CommentsTextInput/CustomTextInput3'
import { insertAttachmentInsideEditor, TASK_THEME } from '../../Feeds/CommentsTextInput/textInputHelper'
import styles, { colors } from '../../styles/global'
import Button from '../../UIControls/Button'
import { useSelector } from 'react-redux'
import AddFeedAttachButton from '../../Feeds/AddFeed/AddFeedAttachButton'
import { hasPendingDescriptionAttachments, updateNewAttachmentsData } from '../../Feeds/Utils/HelperFunctions'
import Backend from '../../../utils/BackendBridge'
import {
    FEED_TASK_OBJECT_TYPE,
    FEED_GOAL_OBJECT_TYPE,
    FEED_PROJECT_OBJECT_TYPE,
    FEED_SKILL_OBJECT_TYPE,
    FEED_ASSISTANT_OBJECT_TYPE,
} from '../../Feeds/Utils/FeedsConstants'
import { translate } from '../../../i18n/TranslationService'
import { updateAssistantDescription } from '../../../utils/backends/Assistants/assistantsFirestore'
import { setTaskDescription } from '../../../utils/backends/Tasks/tasksFirestore'
import AttachmentDropZone from '../../Feeds/CommentsTextInput/AttachmentDropZone'
import { getDescriptionDraft } from './descriptionAutosave'
import { subscribePageHidden } from '../../../utils/appResume'

export default function DescriptionField(props) {
    const userId = useSelector(state => state.loggedUser?.uid)
    const draftKey = JSON.stringify([userId, props.projectId, props.objectType, props.object.id || props.object.uid])
    return <DescriptionEditor key={draftKey} {...props} draftKey={draftKey} />
}

function DescriptionEditor({ projectId, object, disabled, objectType, isCalendarTask, helperText, draftKey }) {
    const smallScreen = useSelector(state => state.smallScreen)
    const [inputCursorIndex, setInputCursorIndex] = useState(0)
    const [editor, setEditor] = useState(null)
    const [mentionsModalActive, setMentionsModalActive] = useState(false)
    const inputRef = useRef()
    const objectRef = useRef(object)
    const applyingRemote = useRef(false)
    objectRef.current = object

    const [draft] = useState(() =>
        getDescriptionDraft(draftKey, {
            initialText: object.description,
            upload: (text, uploadedTokens) =>
                updateNewAttachmentsData(projectId, text, { strict: true, uploadedTokens }),
            save: (finalDescription, oldDescription) => {
                const currentObject = { ...objectRef.current, description: oldDescription }
                if (objectType === FEED_TASK_OBJECT_TYPE) {
                    return setTaskDescription(
                        projectId,
                        currentObject.id,
                        finalDescription,
                        currentObject,
                        oldDescription
                    )
                } else if (objectType === FEED_GOAL_OBJECT_TYPE) {
                    return Backend.setGoalDescription(
                        projectId,
                        currentObject.id,
                        finalDescription,
                        currentObject,
                        oldDescription
                    )
                } else if (objectType === FEED_PROJECT_OBJECT_TYPE) {
                    return Backend.setProjectDescription(projectId, finalDescription, currentObject, oldDescription)
                } else if (objectType === FEED_SKILL_OBJECT_TYPE) {
                    return Backend.updateSkillDescription(projectId, currentObject, finalDescription)
                } else if (objectType === FEED_ASSISTANT_OBJECT_TYPE) {
                    return updateAssistantDescription(projectId, finalDescription, currentObject)
                }
                throw new Error('Unsupported description type')
            },
        })
    )
    const [draftState, setDraftState] = useState(draft.snapshot)

    useEffect(() => draft.subscribe(setDraftState), [draft])

    useEffect(() => {
        const remoteText = object.description || ''
        if (remoteText === draft.snapshot().text || !draft.receiveRemote(remoteText)) return
        applyingRemote.current = true
        inputRef.current?.clearAndSetContent(remoteText)
        applyingRemote.current = false
    }, [object.description, draft])

    const changeDescription = text => {
        if (disabled || applyingRemote.current) return
        draft.change(text, hasPendingDescriptionAttachments)
    }

    const addAttachmentTag = (text, uri) => {
        if (!disabled) insertAttachmentInsideEditor(inputCursorIndex, editor, text, uri)
    }

    useEffect(() => {
        inputRef.current?.blur()
        Keyboard.dismiss()
    }, [])

    useEffect(() => {
        const unsubscribePageHidden = subscribePageHidden(draft.flush)
        const onOnline = () => {
            if (draft.pending) draft.flush()
        }
        window.addEventListener('online', onOnline)
        return () => {
            unsubscribePageHidden()
            window.removeEventListener('online', onOnline)
        }
    }, [draft])

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
        <View
            style={localStyles.container}
            onBlur={event => {
                if (!event.currentTarget?.contains?.(event.relatedTarget)) draft.flush()
            }}
        >
            <Text style={localStyles.header}>{translate('Description')}</Text>
            <AttachmentDropZone
                testID="task-description-attachment-drop-zone"
                style={localStyles.inputContainer}
                disabled={disabled}
                editor={editor}
                inputCursorIndex={inputCursorIndex}
                projectId={projectId}
                setInputCursorIndex={setInputCursorIndex}
            >
                <CustomTextInput3
                    ref={inputRef}
                    placeholder={getPlaceholder()}
                    placeholderTextColor={colors.Text03}
                    onChangeText={changeDescription}
                    multiline={true}
                    externalTextStyle={localStyles.textInputText}
                    externalAlignment={{ paddingLeft: 0, paddingRight: 0 }}
                    setMentionsModalActive={setMentionsModalActive}
                    initialTextExtended={draftState.text}
                    projectId={projectId}
                    styleTheme={TASK_THEME}
                    setInputCursorIndex={setInputCursorIndex}
                    initialCursorIndex={inputCursorIndex}
                    disabledEdition={disabled}
                    setEditor={setEditor}
                    otherFormats={['image', 'attachment', 'customImageFormat', 'videoFormat']}
                    isCalendarTask={isCalendarTask}
                    keepBreakLines={true}
                    allowPlainEnterBreakLines={!mentionsModalActive}
                />
            </AttachmentDropZone>
            {!!helperText && <Text style={localStyles.helperText}>{translate(helperText)}</Text>}

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
                    <View accessibilityLiveRegion="polite">
                        {draftState.status === 'saving' && (
                            <Text style={localStyles.helperText}>{translate('Saving')}</Text>
                        )}
                        {draftState.status === 'saved' && (
                            <Text style={localStyles.helperText}>{translate('Description saved')}</Text>
                        )}
                        {draftState.status === 'error' && (
                            <>
                                <Text accessibilityRole="alert" style={localStyles.helperText}>
                                    {translate('Description autosave failed')}
                                </Text>
                                <Button title={translate('Try again')} type={'ghost'} onPress={draft.flush} />
                            </>
                        )}
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
    helperText: {
        ...styles.caption1,
        color: colors.Text03,
        marginBottom: 8,
    },
    buttonsContainer: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
    },
})
