import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react'
import { View } from 'react-native'
import { useDispatch, useSelector } from 'react-redux'
import moment from 'moment'

import VariableModal from '../VariableModal/VariableModal'
import TaskModal, { TASK_TYPE_PROMPT } from './TaskModal'
import { updatePreConfigTask, uploadNewPreConfigTask } from '../../../../utils/backends/Assistants/assistantsFirestore'
import { CONFIRM_POPUP_TRIGGER_DELETE_PRE_CONFIG_TASK } from '../../ConfirmPopup'
import { showConfirmPopup } from '../../../../redux/actions'
import {
    getAssistantInProjectObject,
    getGlobalAssistant,
    isGlobalAssistant,
    GLOBAL_PROJECT_ID,
} from '../../../AdminPanel/Assistants/assistantsHelper'
import { RECURRENCE_NEVER } from '../../../TaskListView/Utils/TasksHelper'

export default function PreConfigTaskModal({ disabled, projectId, closeModal, adding, assistantId, task }) {
    const dispatch = useDispatch()
    const loggedUser = useSelector(state => state.loggedUser)
    const selectedProjectIndex = useSelector(state => state.selectedProjectIndex)
    const loggedUserProjects = useSelector(state => state.loggedUserProjects)
    const selectedProjectId = loggedUserProjects[selectedProjectIndex]?.id
    const currentProjectId = projectId === GLOBAL_PROJECT_ID && selectedProjectId ? selectedProjectId : projectId
    const currentAssistant = useMemo(
        () =>
            adding
                ? isGlobalAssistant(assistantId)
                    ? getGlobalAssistant(assistantId)
                    : getAssistantInProjectObject(projectId, assistantId)
                : null,
        [adding, assistantId, projectId]
    )

    console.log('PreConfigTaskModal props:', {
        disabled,
        projectId,
        adding,
        assistantId,
        taskData: task,
        currentAssistant,
    })

    const initialState = useMemo(() => {
        const getInitialStartDate = () => {
            if (task?.startDate) {
                // If startDate is already a timestamp, use it
                if (typeof task.startDate === 'number') {
                    return task.startDate
                }
                // If we have a date string and time string, combine them
                const date = moment(task.startDate)
                if (task.startTime) {
                    const [hours, minutes] = task.startTime.split(':').map(Number)
                    date.hour(hours).minute(minutes)
                }
                return date.valueOf()
            }
            // For new tasks, default to tomorrow at 9 AM
            return moment().add(1, 'day').startOf('day').hour(9).minute(0).valueOf()
        }

        return {
            name: task ? task.name : '',
            prompt: task ? task.prompt : '',
            link: task ? task.link : '',
            taskType: task ? task.type : TASK_TYPE_PROMPT,
            variables: task ? task.variables : [],
            aiModel: task ? task.aiModel : currentAssistant ? currentAssistant.model : '',
            aiTemperature: task ? task.aiTemperature : currentAssistant ? currentAssistant.temperature : '',
            aiSystemMessage: task ? task.aiSystemMessage : currentAssistant ? currentAssistant.instructions : '',
            recurrence: task ? task.recurrence : RECURRENCE_NEVER,
            startDate: getInitialStartDate(),
            sendWhatsApp: task ? task.sendWhatsApp : false,
        }
    }, [task, currentAssistant])

    console.log('PreConfigTaskModal initialState:', {
        taskStartDate: task?.startDate,
        taskStartTime: task?.startTime,
        initialStartDate: initialState.startDate,
        formattedInitialDate: moment(initialState.startDate).format('YYYY-MM-DD HH:mm:ss'),
        startDateType: typeof initialState.startDate,
    })

    const [name, setName] = useState(initialState.name)
    const [prompt, setPrompt] = useState(initialState.prompt)
    const [link, setLink] = useState(initialState.link)
    const [taskType, setTaskType] = useState(initialState.taskType)
    const [variables, setVariables] = useState(initialState.variables)
    const [activeVariableIndex, setActiveVariableIndex] = useState(null)
    const [showVariableModal, setShowVariableModal] = useState(false)
    const [aiModel, setAiModel] = useState(initialState.aiModel)
    const [aiTemperature, setAiTemperature] = useState(initialState.aiTemperature)
    const [aiSystemMessage, setAiSystemMessage] = useState(initialState.aiSystemMessage)
    const [recurrence, setRecurrence] = useState(initialState.recurrence)
    const [startDate, setStartDate] = useState(initialState.startDate)
    const [sendWhatsApp, setSendWhatsApp] = useState(initialState.sendWhatsApp)

    const handleSetStartDate = useCallback(value => {
        console.log('PreConfigTaskModal - handleSetStartDate called with:', {
            value,
            valueType: typeof value,
            formattedDate: moment(value).format('YYYY-MM-DD HH:mm:ss'),
        })
        setStartDate(value)
    }, [])

    console.log('PreConfigTaskModal state initialized:', {
        aiModel,
        aiTemperature,
        aiSystemMessage,
        taskType,
        fromAssistant: !!currentAssistant,
    })

    const promptInputRef = useRef()
    const linkInputRef = useRef()

    const handleSetRecurrence = useCallback(value => {
        console.log('PreConfigTaskModal - handleSetRecurrence called with:', value)
        setRecurrence(value)
    }, [])

    const handleSetName = useCallback(value => {
        console.log('PreConfigTaskModal - handleSetName called with:', value)
        setName(value)
    }, [])

    const addTask = () => {
        console.log('Adding task with startDate:', {
            startDate,
            formattedDate: moment(startDate).format('YYYY-MM-DD'),
            formattedTime: moment(startDate).format('HH:mm'),
            fullDateTime: moment(startDate).format('YYYY-MM-DD HH:mm:ss'),
            startDateType: typeof startDate,
            userTimezone: moment().format('Z'),
        })
        closeModal()

        // Convert startDate to UTC by removing the local timezone offset
        const utcStartDate = moment(startDate).utc().valueOf()

        const newTask =
            taskType === TASK_TYPE_PROMPT
                ? {
                      name,
                      type: taskType,
                      prompt,
                      variables,
                      link: '',
                      aiModel: aiModel || currentAssistant?.model || 'MODEL_GPT3_5',
                      aiTemperature: aiTemperature || currentAssistant?.temperature || 'TEMPERATURE_NORMAL',
                      aiSystemMessage: aiSystemMessage || currentAssistant?.instructions || '',
                      recurrence,
                      startDate: utcStartDate,
                      startTime: moment(startDate).format('HH:mm'),
                      userTimezone: parseInt(moment().format('Z')), // Store user's timezone offset
                      creatorUserId: loggedUser.uid, // Store the creator's user ID
                      activatedInProjectId: currentProjectId,
                      sendWhatsApp,
                  }
                : { name, type: taskType, prompt: '', variables: [], link, recurrence, sendWhatsApp }
        setTimeout(() => {
            uploadNewPreConfigTask(projectId, assistantId, newTask)
        }, 1000)
    }

    const saveTask = () => {
        console.log('Saving task with startDate:', {
            startDate,
            formattedDate: moment(startDate).format('YYYY-MM-DD'),
            formattedTime: moment(startDate).format('HH:mm'),
            fullDateTime: moment(startDate).format('YYYY-MM-DD HH:mm:ss'),
            startDateType: typeof startDate,
            userTimezone: moment().format('Z'),
        })

        // Convert startDate to UTC by removing the local timezone offset
        const utcStartDate = moment(startDate).utc().valueOf()

        const updatedTask =
            taskType === TASK_TYPE_PROMPT
                ? {
                      ...task,
                      name,
                      type: taskType,
                      prompt,
                      variables,
                      link: '',
                      aiModel: aiModel || currentAssistant?.model || 'MODEL_GPT3_5',
                      aiTemperature: aiTemperature || currentAssistant?.temperature || 'TEMPERATURE_NORMAL',
                      aiSystemMessage: aiSystemMessage || currentAssistant?.instructions || '',
                      recurrence: recurrence ?? null,
                      startDate: utcStartDate,
                      startTime: moment(startDate).format('HH:mm'),
                      userTimezone: parseInt(moment().format('Z')), // Store user's timezone offset
                      creatorUserId: loggedUser.uid, // Store the creator's user ID
                      activatedInProjectId: currentProjectId,
                      sendWhatsApp,
                  }
                : {
                      ...task,
                      name,
                      type: taskType,
                      prompt: '',
                      variables: [],
                      link,
                      recurrence: recurrence ?? null,
                      sendWhatsApp,
                  }
        updatePreConfigTask(projectId, assistantId, updatedTask)
        closeModal()
    }

    const deleteTask = () => {
        dispatch(
            showConfirmPopup({
                trigger: CONFIRM_POPUP_TRIGGER_DELETE_PRE_CONFIG_TASK,
                object: {
                    taskId: task.id,
                    projectId: projectId,
                    assistantId: assistantId,
                },
            })
        )
        closeModal()
    }

    const addVariable = variable => {
        setVariables(state => [...state, variable])
        setTimeout(() => {
            const newPrompt = prompt.trim() + ` $${variable.name}`
            const editor = promptInputRef.current.getEditor()
            editor.setText(newPrompt, 'user')
        })
    }

    const removeVariable = variableIndex => {
        setVariables(state => state.toSpliced(variableIndex, 1))
        const newPrompt = prompt.trim().replaceAll(`$${variables[variableIndex].name}`, ``)
        promptInputRef.current.getEditor().setText(newPrompt, 'user')
    }

    const updateVariable = (variable, variableIndex) => {
        setVariables(state => {
            const newState = [...state]
            newState[variableIndex] = variable
            return newState
        })
        setTimeout(() => {
            const newPrompt = prompt.trim().replaceAll(`$${variables[variableIndex].name}`, `$${variable.name}`)
            promptInputRef.current.getEditor().setText(newPrompt, 'user')
        })
    }

    const openVariableModal = variableIndex => {
        setShowVariableModal(true)
        setActiveVariableIndex(variableIndex)
    }

    const closeVariableModal = () => {
        setShowVariableModal(false)
        setActiveVariableIndex(null)
    }

    return (
        <View>
            {showVariableModal ? (
                <VariableModal
                    closeModal={closeVariableModal}
                    addVariable={addVariable}
                    updateVariable={updateVariable}
                    variableIndex={activeVariableIndex}
                    variables={variables}
                    disabled={disabled}
                />
            ) : (
                <TaskModal
                    closeModal={closeModal}
                    adding={adding}
                    name={name}
                    setName={handleSetName}
                    prompt={prompt}
                    setPrompt={setPrompt}
                    variables={variables}
                    openVariableModal={openVariableModal}
                    removeVariable={removeVariable}
                    addTask={addTask}
                    saveTask={saveTask}
                    deleteTask={deleteTask}
                    disabled={disabled}
                    promptInputRef={promptInputRef}
                    linkInputRef={linkInputRef}
                    link={link}
                    setLink={setLink}
                    taskType={taskType}
                    setTaskType={setTaskType}
                    aiModel={aiModel}
                    setAiModel={setAiModel}
                    aiTemperature={aiTemperature}
                    setAiTemperature={setAiTemperature}
                    aiSystemMessage={aiSystemMessage}
                    setAiSystemMessage={setAiSystemMessage}
                    projectId={projectId}
                    assistantId={assistantId}
                    recurrence={recurrence}
                    setRecurrence={handleSetRecurrence}
                    startDate={startDate}
                    setStartDate={handleSetStartDate}
                    sendWhatsApp={sendWhatsApp}
                    setSendWhatsApp={setSendWhatsApp}
                />
            )}
        </View>
    )
}
