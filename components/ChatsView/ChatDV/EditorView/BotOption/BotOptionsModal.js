import React, { useEffect, useState } from 'react'
import { StyleSheet, View } from 'react-native'
import { useDispatch } from 'react-redux'

import { MODAL_MAX_HEIGHT_GAP, applyPopoverWidth } from '../../../../../utils/HelperFunctions'
import { colors } from '../../../../styles/global'
import useWindowSize from '../../../../../utils/useWindowSize'
import { translate } from '../../../../../i18n/TranslationService'
import ModalHeader from '../../../../UIComponents/FloatModals/ModalHeader'
import CustomScrollView from '../../../../UIControls/CustomScrollView'
import { BOT_OPTION_MODAL_ID, removeModal, storeModal } from '../../../../ModalsManager/modalsManager'
import Line from '../../../../UIComponents/FloatModals/GoalMilestoneModal/Line'
import PreConfigTasksArea from './PreConfigTasksArea'
import StopChatingOption from './StopChatingOption'
import StartChatingOption from './StartChatingOption'
import PreConfigTaskGeneratorModal from '../../../../UIComponents/FloatModals/PreConfigTaskGeneratorModal/PreConfigTaskGeneratorModal'
import { getAssistantInProjectObject } from '../../../../AdminPanel/Assistants/assistantsHelper'
import { setAssistantEnabled } from '../../../../../redux/actions'
import SelectAssistantsOption from './SelectAssistantsOption'
import AssistantModal from '../../../../UIComponents/FloatModals/ChangeAssistantModal/AssistantModal'
import { setTaskAssistant } from '../../../../../utils/backends/Tasks/tasksFirestore'
import { updateChatAssistant } from '../../../../../utils/backends/Chats/chatsFirestore'
import { setNoteAssistant } from '../../../../../utils/backends/Notes/notesFirestore'
import { setContactAssistant } from '../../../../../utils/backends/Contacts/contactsFirestore'
import { setUserAssistant } from '../../../../../utils/backends/Users/usersFirestore'
import { setSkillAssistant } from '../../../../../utils/backends/Skills/skillsFirestore'

import { setGoalAssistant } from '../../../../../utils/backends/Goals/goalsFirestore'
import { setSelectedNote, setTaskInDetailView } from '../../../../../redux/actions'
import { setObjectAssistantEnabled } from '../../../../../utils/assistantHelper'

const normalizeAssistantObjectType = objectType => {
    switch (objectType) {
        case 'task':
            return 'tasks'
        case 'chat':
            return 'chats'
        case 'topic':
            return 'topics'
        case 'note':
            return 'notes'
        case 'contact':
            return 'contacts'
        case 'user':
            return 'users'
        case 'skill':
            return 'skills'
        case 'goal':
            return 'goals'
        default:
            return objectType
    }
}

export default function BotOptionsModal({
    objectType,
    objectId,
    closeModal,
    onSelectBotOption,
    assistantId,
    projectId,
    setAssistantId,
    inMyDay,
    inChatTab,
    parentObject,
    updateObjectState,
}) {
    const dispatch = useDispatch()
    const [selectedTask, setSelectedTask] = useState(null)
    const [showAssistants, setShowAssistants] = useState(false)
    const [width, height] = useWindowSize()
    const normalizedObjectType = normalizeAssistantObjectType(objectType)

    const assistant = getAssistantInProjectObject(projectId, assistantId)

    const setAssistantEnabledForObject = isEnabled => {
        setObjectAssistantEnabled(projectId, objectId, normalizedObjectType, isEnabled)
        if (parentObject) {
            const updatedObject = { ...parentObject, isAssistantEnabled: isEnabled }
            if (normalizedObjectType === 'tasks') {
                dispatch(setTaskInDetailView(updatedObject))
            } else if (normalizedObjectType === 'notes') {
                dispatch(setSelectedNote(updatedObject))
            }
            if (updateObjectState) {
                updateObjectState(updatedObject)
            }
        }
        dispatch(setAssistantEnabled(isEnabled))
    }

    const updateAssistant = async selectedAssistantId => {
        console.log('[BotOptionsModal] updateAssistant called:', {
            objectType,
            normalizedObjectType,
            projectId,
            objectId,
            previousAssistantId: assistantId,
            selectedAssistantId,
        })

        setAssistantId?.(selectedAssistantId)

        if (normalizedObjectType === 'tasks') {
            await setTaskAssistant(projectId, objectId, selectedAssistantId, true)
        } else if (normalizedObjectType === 'chats' || normalizedObjectType === 'topics') {
            await updateChatAssistant(projectId, objectId, selectedAssistantId)
        } else if (normalizedObjectType === 'notes') {
            await setNoteAssistant(projectId, objectId, selectedAssistantId, true)
        } else if (normalizedObjectType === 'contacts') {
            await setContactAssistant(projectId, objectId, selectedAssistantId, true)
        } else if (normalizedObjectType === 'users') {
            await setUserAssistant(projectId, objectId, selectedAssistantId, true)
        } else if (normalizedObjectType === 'skills') {
            await setSkillAssistant(projectId, objectId, selectedAssistantId, true)
        } else if (normalizedObjectType === 'goals') {
            await setGoalAssistant(projectId, objectId, selectedAssistantId, true)
        }

        // Optimistic update for UI
        if (parentObject) {
            const updatedObject = { ...parentObject, assistantId: selectedAssistantId }
            if (normalizedObjectType === 'tasks') {
                dispatch(setTaskInDetailView(updatedObject))
            } else if (normalizedObjectType === 'notes') {
                dispatch(setSelectedNote(updatedObject))
            }
        }

        // Optimistic update for UI via local state (prevents overwrite on tab change)
        if (parentObject && updateObjectState) {
            const updatedObject = { ...parentObject, assistantId: selectedAssistantId }
            updateObjectState(updatedObject)
        }

        dispatch(setAssistantEnabled(true))
        if (onSelectBotOption) onSelectBotOption()
        closeModal()
    }

    const enableAssistantForObject = () => {
        if (inChatTab) {
            setAssistantEnabledForObject(true)
        } else if (!inMyDay) {
            dispatch(setAssistantEnabled(true))
        }
    }

    const toggleAssistantEnabled = isEnabled => {
        closeModal()
        setAssistantEnabledForObject(isEnabled)
        if (onSelectBotOption) onSelectBotOption()
    }

    useEffect(() => {
        storeModal(BOT_OPTION_MODAL_ID)
        return () => {
            removeModal(BOT_OPTION_MODAL_ID)
        }
    }, [])

    return (
        <View style={[localStyles.container, applyPopoverWidth(), { maxHeight: height - MODAL_MAX_HEIGHT_GAP }]}>
            {showAssistants ? (
                <AssistantModal
                    closeModal={() => {
                        setShowAssistants(false)
                        onSelectBotOption()
                    }}
                    projectId={projectId}
                    updateAssistant={updateAssistant}
                    currentAssistantId={assistantId || assistant?.uid}
                />
            ) : selectedTask ? (
                <PreConfigTaskGeneratorModal
                    projectId={projectId}
                    closeModal={() => {
                        setSelectedTask(null)
                        closeModal()
                    }}
                    task={selectedTask}
                    assistant={assistant}
                    processPromp={prompt => {
                        if (inChatTab) {
                            setAssistantEnabledForObject(true)
                        }
                        onSelectBotOption(prompt, selectedTask.name)
                        if (!inMyDay) dispatch(setAssistantEnabled(true))
                    }}
                    defaultContext={
                        parentObject
                            ? {
                                  name: parentObject.title || parentObject.name,
                                  id: parentObject.noteId || parentObject.id || parentObject.uid,
                                  type: parentObject.noteId ? 'note' : normalizedObjectType,
                              }
                            : null
                    }
                />
            ) : (
                <CustomScrollView style={localStyles.scroll} showsVerticalScrollIndicator={false}>
                    <ModalHeader
                        closeModal={closeModal}
                        title={translate('Alldone assistant')}
                        description={translate('Using the Alldone Assistant will cost gold based on how much you chat')}
                        description2={translate('Select from the options below')}
                    />
                    {normalizedObjectType !== 'assistants' && (
                        <>
                            <SelectAssistantsOption setShowAssistants={setShowAssistants} />
                            <Line style={{ marginVertical: 4 }} />
                        </>
                    )}
                    <StartChatingOption
                        assistant={assistant}
                        closeModal={closeModal}
                        toggleAssistantEnabled={toggleAssistantEnabled}
                        inChatTab={inChatTab}
                    />
                    <PreConfigTasksArea
                        closeModal={closeModal}
                        selectTask={setSelectedTask}
                        assistantId={assistant.uid}
                        projectId={projectId}
                        onSelectBotOption={onSelectBotOption}
                        enableAssistantForObject={enableAssistantForObject}
                        inMyDay={inMyDay}
                    />
                    {!inMyDay && (
                        <>
                            <Line style={{ marginVertical: 4 }} />
                            <StopChatingOption
                                closeModal={closeModal}
                                toggleAssistantEnabled={toggleAssistantEnabled}
                            />
                        </>
                    )}
                </CustomScrollView>
            )}
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        flexDirection: 'column',
        borderRadius: 4,
        backgroundColor: colors.Secondary400,
        shadowColor: 'rgba(78, 93, 120, 0.56)',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 1,
        shadowRadius: 16,
        elevation: 3,
    },
    scroll: {
        padding: 16,
    },
})
