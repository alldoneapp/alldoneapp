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
}) {
    const dispatch = useDispatch()
    const [selectedTask, setSelectedTask] = useState(null)
    const [showAssistants, setShowAssistants] = useState(false)
    const [width, height] = useWindowSize()

    const assistant = getAssistantInProjectObject(projectId, assistantId)

    const updateAssistant = selectedAssistantId => {
        closeModal()
        setAssistantId?.(selectedAssistantId)
        if (objectType === 'tasks') {
            setTaskAssistant(projectId, objectId, selectedAssistantId, true)
        } else if (objectType === 'chats' || objectType === 'topics') {
            updateChatAssistant(projectId, objectId, selectedAssistantId)
        } else if (objectType === 'notes') {
            setNoteAssistant(projectId, objectId, selectedAssistantId, true)
        } else if (objectType === 'contacts') {
            setContactAssistant(projectId, objectId, selectedAssistantId, true)
        } else if (objectType === 'users') {
            setUserAssistant(projectId, objectId, selectedAssistantId, true)
        } else if (objectType === 'skills') {
            setSkillAssistant(projectId, objectId, selectedAssistantId, true)
        } else if (objectType === 'goals') {
            setGoalAssistant(projectId, objectId, selectedAssistantId, true)
        }
        dispatch(setAssistantEnabled(true))
        onSelectBotOption()
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
                    currentAssistantId={assistant.uid}
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
                        onSelectBotOption(prompt, selectedTask.name)
                        if (!inMyDay) dispatch(setAssistantEnabled(true))
                    }}
                />
            ) : (
                <CustomScrollView style={localStyles.scroll} showsVerticalScrollIndicator={false}>
                    <ModalHeader
                        closeModal={closeModal}
                        title={translate('Alldone assistant')}
                        description={translate('Using the Alldone Assistant will cost gold based on how much you chat')}
                        description2={translate('Select from the options below')}
                    />
                    {objectType !== 'assistants' && (
                        <>
                            <SelectAssistantsOption setShowAssistants={setShowAssistants} />
                            <Line style={{ marginVertical: 4 }} />
                        </>
                    )}
                    <StartChatingOption
                        assistant={assistant}
                        closeModal={() => {
                            closeModal()
                            onSelectBotOption()
                        }}
                        inChatTab={inChatTab}
                    />
                    <PreConfigTasksArea
                        closeModal={closeModal}
                        selectTask={setSelectedTask}
                        assistantId={assistant.uid}
                        projectId={projectId}
                        onSelectBotOption={onSelectBotOption}
                        inMyDay={inMyDay}
                    />
                    {!inMyDay && (
                        <>
                            <Line style={{ marginVertical: 4 }} />
                            <StopChatingOption
                                closeModal={() => {
                                    closeModal()
                                    onSelectBotOption()
                                }}
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
