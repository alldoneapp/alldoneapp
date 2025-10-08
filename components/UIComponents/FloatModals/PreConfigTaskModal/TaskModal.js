import React, { useRef, useEffect, useState, memo, useCallback } from 'react'
import { StyleSheet, View, TouchableOpacity, Text } from 'react-native'
import { useSelector } from 'react-redux'

import { colors } from '../../../styles/global'
import styles from '../../../styles/global'
import { applyPopoverWidth, MODAL_MAX_HEIGHT_GAP } from '../../../../utils/HelperFunctions'
import useWindowSize from '../../../../utils/useWindowSize'
import CustomScrollView from '../../../UIControls/CustomScrollView'
import { translate } from '../../../../i18n/TranslationService'
import ModalHeader from '../ModalHeader'
import NameArea from './NameArea'
import PromptArea from './PromptArea'
import ButtonsArea from './ButtonsArea'
import VariablesArea from './VariablesArea'
import DropDown from './DropDown'
import LinkArea from './LinkArea'
import WebhookArea from './WebhookArea'
import AISettingsArea from './AISettingsArea'
import { REGEX_URL } from '../../../Feeds/Utils/HelperFunctions'
import { getAssistantInProjectObject } from '../../../AdminPanel/Assistants/assistantsHelper'
import RecurrenceButton from '../../../UIControls/RecurrenceButton'
import { RECURRENCE_NEVER, RECURRENCE_MAP } from '../../../TaskListView/Utils/TasksHelper'
import Icon from '../../../Icon'
import moment from 'moment'
import DueDateCalendarModal from '../../FloatModals/DueDateCalendarModal/DueDateCalendarModal'
import { getTimeFormat } from '../../FloatModals/DateFormatPickerModal'
import Popover from 'react-tiny-popover'
import RecurrenceModal from '../RecurrenceModal'
import TimePickerModal from '../../FloatModals/TimePickerModal/TimePickerModal'

export const TASK_TYPE_PROMPT = 'prompt'
export const TASK_TYPE_EXTERNAL_LINK = 'link'
export const TASK_TYPE_WEBHOOK = 'webhook'

const MemoizedNameArea = memo(NameArea)

const RecurrencePickerArea = memo(
    ({ recurrence, setRecurrence, disabled, projectId }) => {
        return (
            <View style={localStyles.recurrenceContainer}>
                <View style={{ marginRight: 8 }}>
                    <Icon name="rotate-cw" size={24} color={colors.Text03} />
                </View>
                <Text style={[styles.subtitle2, { color: colors.Text03 }]}>{translate('Recurring')}</Text>
                <View style={{ marginLeft: 'auto' }}>
                    <TouchableOpacity
                        style={localStyles.dateButton}
                        onPress={() => {
                            console.log('Recurrence button - onPress called')
                            setRecurrence()
                        }}
                        disabled={disabled}
                    >
                        <Text style={[styles.subtitle2, { color: colors.Text02 }]}>
                            {translate((RECURRENCE_MAP[recurrence] || RECURRENCE_MAP[RECURRENCE_NEVER]).large)}
                        </Text>
                    </TouchableOpacity>
                </View>
            </View>
        )
    },
    (prevProps, nextProps) => prevProps.recurrence === nextProps.recurrence && prevProps.disabled === nextProps.disabled
)

const MemoizedModalContent = memo(
    ({
        disabled,
        nameInputRef,
        name,
        setName,
        taskType,
        setTaskType,
        items,
        smallScreenNavigation,
        isMiddleScreen,
        promptInputRef,
        prompt,
        setPrompt,
        variables,
        openVariableModal,
        removeVariable,
        recurrence,
        setRecurrence,
        projectId,
        startDate,
        setStartDate,
        showDatePicker,
        setShowDatePicker,
        showTimePicker,
        setShowTimePicker,
        timeFormat,
        showAISettings,
        setShowAISettings,
        aiModel,
        setAiModel,
        aiTemperature,
        setAiTemperature,
        aiSystemMessage,
        setAiSystemMessage,
        link,
        setLink,
        linkInputRef,
        checkIfIsValidLink,
        adding,
        addTask,
        saveTask,
        deleteTask,
        disableButton,
        closeModal,
        handleStartTimeChange,
        sendWhatsApp,
        setSendWhatsApp,
        webhookUrl,
        setWebhookUrl,
        webhookAuth,
        setWebhookAuth,
        webhookPrompt,
        setWebhookPrompt,
    }) => {
        const handleModalClick = useCallback(e => {
            const target = e.target
            if (
                target.closest('.ql-editor') ||
                target.closest('.ql-toolbar') ||
                target.closest('.ql-textInputContainer') ||
                target.closest('.ql-textInputEditor') ||
                target.closest('[class*="container"]') ||
                target.closest('.customTextInput3') ||
                target.closest('.dropdown-content') ||
                target.closest('.prompt-area')
            ) {
                return
            }
            e.preventDefault()
            e.stopPropagation()
        }, [])

        return (
            <CustomScrollView
                style={localStyles.scroll}
                showsVerticalScrollIndicator={false}
                onMouseDown={handleModalClick}
                onClick={handleModalClick}
            >
                <ModalHeader
                    title={translate(adding ? 'Add new task' : 'Update task')}
                    description={translate(
                        adding ? 'Enter the data to add the task' : 'Change the data to update the task'
                    )}
                    closeModal={closeModal}
                />
                <div style={{ position: 'relative', zIndex: 1005 }}>
                    <MemoizedNameArea disabled={disabled} nameInputRef={nameInputRef} name={name} setName={setName} />
                    <DropDown
                        items={items}
                        value={taskType}
                        setValue={setTaskType}
                        placeholder={translate('Choose the task type')}
                        header={translate('Task type')}
                        containerStyle={{ marginTop: 12, position: 'relative', zIndex: 1005 }}
                        disabled={disabled}
                        arrowStyle={{
                            position: 'absolute',
                            top: -32,
                            left: smallScreenNavigation ? 232 : isMiddleScreen ? 296 : 360,
                            zIndex: 1005,
                        }}
                    />
                </div>
                {taskType === TASK_TYPE_PROMPT ? (
                    <>
                        <div
                            style={{ position: 'relative', zIndex: 1003 }}
                            className="prompt-area"
                            onMouseDown={e => {
                                e.stopPropagation()
                            }}
                            onClick={e => {
                                e.stopPropagation()
                            }}
                        >
                            <PromptArea
                                disabled={disabled}
                                promptInputRef={promptInputRef}
                                prompt={prompt}
                                setPrompt={setPrompt}
                            />
                        </div>
                        <VariablesArea
                            disabled={disabled}
                            variables={variables}
                            openVariableModal={openVariableModal}
                            removeVariable={removeVariable}
                        />
                        <View style={localStyles.recurrenceContainer}>
                            <View style={{ marginRight: 8 }}>
                                <Icon name="message-circle" size={24} color={colors.Text03} />
                            </View>
                            <Text style={[styles.subtitle2, { color: colors.Text03 }]}>
                                {translate('WhatsApp notification')}
                            </Text>
                            <View style={{ marginLeft: 'auto' }}>
                                <TouchableOpacity
                                    style={[localStyles.checkboxContainer, sendWhatsApp && localStyles.checkboxActive]}
                                    onPress={() => !disabled && setSendWhatsApp(!sendWhatsApp)}
                                    disabled={disabled}
                                >
                                    {sendWhatsApp && <Icon name="check" size={16} color={colors.Primary500} />}
                                </TouchableOpacity>
                            </View>
                        </View>
                        <RecurrencePickerArea
                            recurrence={recurrence}
                            setRecurrence={setRecurrence}
                            disabled={disabled}
                            projectId={projectId}
                        />
                        {recurrence !== RECURRENCE_NEVER && (
                            <>
                                <View style={localStyles.recurrenceContainer}>
                                    <View style={{ marginRight: 8 }}>
                                        <Icon name="calendar" size={24} color={colors.Text03} />
                                    </View>
                                    <Text style={[styles.subtitle2, { color: colors.Text03 }]}>
                                        {translate('Start date')}
                                    </Text>
                                    <View style={{ marginLeft: 'auto' }}>
                                        <Popover
                                            isOpen={showDatePicker}
                                            positions={['bottom', 'left', 'right', 'top']}
                                            padding={4}
                                            onClickOutside={() => setShowDatePicker(false)}
                                            containerStyle={{ zIndex: 1000 }}
                                            content={
                                                <div onClick={e => e.stopPropagation()} style={{ zIndex: 1000 }}>
                                                    <DueDateCalendarModal
                                                        initialDate={startDate}
                                                        closePopover={() => {
                                                            setShowDatePicker(false)
                                                        }}
                                                        updateDate={date => {
                                                            const newDate = moment(date)
                                                                .hour(moment(startDate).hour())
                                                                .minute(moment(startDate).minute())
                                                                .valueOf()
                                                            setStartDate(newDate)
                                                        }}
                                                        saveDueDateBeforeSaveTask={(date, isObservedTabActive) => {
                                                            const newDate = moment(date)
                                                                .hour(moment(startDate).hour())
                                                                .minute(moment(startDate).minute())
                                                                .valueOf()
                                                            setStartDate(newDate)
                                                            setShowDatePicker(false)
                                                        }}
                                                    />
                                                </div>
                                            }
                                        >
                                            <TouchableOpacity
                                                style={localStyles.dateButton}
                                                onPress={() => setShowDatePicker(true)}
                                                disabled={disabled}
                                            >
                                                <Text style={[styles.subtitle2, { color: colors.Text02 }]}>
                                                    {moment(startDate).format('DD.MM.YYYY')}
                                                </Text>
                                            </TouchableOpacity>
                                        </Popover>
                                    </View>
                                </View>
                                <View style={localStyles.recurrenceContainer}>
                                    <View style={{ marginRight: 8 }}>
                                        <Icon name="clock" size={24} color={colors.Text03} />
                                    </View>
                                    <Text style={[styles.subtitle2, { color: colors.Text03 }]}>
                                        {translate('Start time')}
                                    </Text>
                                    <View style={{ marginLeft: 'auto' }}>
                                        <Popover
                                            isOpen={showTimePicker}
                                            positions={['bottom', 'left', 'right', 'top']}
                                            padding={4}
                                            onClickOutside={() => setShowTimePicker(false)}
                                            containerStyle={{ zIndex: 1001 }}
                                            content={
                                                <div onClick={e => e.stopPropagation()} style={{ zIndex: 1001 }}>
                                                    <TimePickerModal
                                                        initialTime={startDate}
                                                        closePopover={() => setShowTimePicker(false)}
                                                        updateTime={handleStartTimeChange}
                                                        saveTimeBeforeSaveTask={handleStartTimeChange}
                                                        timeFormat={timeFormat}
                                                    />
                                                </div>
                                            }
                                        >
                                            <TouchableOpacity
                                                style={localStyles.dateButton}
                                                onPress={() => setShowTimePicker(true)}
                                                disabled={disabled}
                                            >
                                                <Text style={[styles.subtitle2, { color: colors.Text02 }]}>
                                                    {moment(startDate).format(timeFormat)}
                                                </Text>
                                            </TouchableOpacity>
                                        </Popover>
                                    </View>
                                </View>
                            </>
                        )}
                        <TouchableOpacity
                            style={localStyles.advancedSettingsButton}
                            onPress={() => setShowAISettings(!showAISettings)}
                            disabled={disabled}
                        >
                            <Text style={[localStyles.advancedSettingsText, disabled && localStyles.disabledText]}>
                                {translate(showAISettings ? 'Hide Advanced settings' : 'Show Advanced settings')}
                            </Text>
                        </TouchableOpacity>
                        {showAISettings && (
                            <div
                                onMouseDown={e => {
                                    if (e.target.closest('.ql-editor') || e.target.closest('.ql-toolbar')) {
                                        return
                                    }
                                    e.preventDefault()
                                    e.stopPropagation()
                                }}
                                onClick={e => {
                                    if (e.target.closest('.ql-editor') || e.target.closest('.ql-toolbar')) {
                                        return
                                    }
                                    e.preventDefault()
                                    e.stopPropagation()
                                }}
                                style={{ position: 'relative', zIndex: 1 }}
                            >
                                <AISettingsArea
                                    disabled={disabled}
                                    aiModel={aiModel}
                                    setAiModel={setAiModel}
                                    aiTemperature={aiTemperature}
                                    setAiTemperature={setAiTemperature}
                                    aiSystemMessage={aiSystemMessage}
                                    setAiSystemMessage={setAiSystemMessage}
                                    isMiddleScreen={isMiddleScreen}
                                    smallScreenNavigation={smallScreenNavigation}
                                />
                            </div>
                        )}
                    </>
                ) : taskType === TASK_TYPE_WEBHOOK ? (
                    <WebhookArea
                        disabled={disabled}
                        webhookUrl={webhookUrl}
                        setWebhookUrl={setWebhookUrl}
                        webhookAuth={webhookAuth}
                        setWebhookAuth={setWebhookAuth}
                        webhookPrompt={webhookPrompt}
                        setWebhookPrompt={setWebhookPrompt}
                        webhookPromptInputRef={promptInputRef}
                    />
                ) : (
                    <LinkArea
                        disabled={disabled}
                        linkInputRef={linkInputRef}
                        link={link}
                        setLink={setLink}
                        isValid={checkIfIsValidLink()}
                    />
                )}
                {!disabled && (
                    <ButtonsArea
                        adding={adding}
                        addTask={addTask}
                        saveTask={saveTask}
                        deleteTask={deleteTask}
                        disableButton={disableButton}
                    />
                )}
            </CustomScrollView>
        )
    },
    (prevProps, nextProps) => {
        // Deep compare objects and arrays
        const compareArrays = (arr1, arr2) => {
            if (arr1.length !== arr2.length) return false
            return arr1.every((item, index) => {
                if (typeof item === 'object') {
                    return JSON.stringify(item) === JSON.stringify(arr2[index])
                }
                return item === arr2[index]
            })
        }

        return (
            prevProps.name === nextProps.name &&
            prevProps.taskType === nextProps.taskType &&
            prevProps.prompt === nextProps.prompt &&
            prevProps.recurrence === nextProps.recurrence &&
            prevProps.disabled === nextProps.disabled &&
            prevProps.showDatePicker === nextProps.showDatePicker &&
            prevProps.showTimePicker === nextProps.showTimePicker &&
            prevProps.showAISettings === nextProps.showAISettings &&
            prevProps.startDate === nextProps.startDate &&
            prevProps.aiModel === nextProps.aiModel &&
            prevProps.aiTemperature === nextProps.aiTemperature &&
            prevProps.aiSystemMessage === nextProps.aiSystemMessage &&
            prevProps.link === nextProps.link &&
            prevProps.sendWhatsApp === nextProps.sendWhatsApp &&
            prevProps.webhookUrl === nextProps.webhookUrl &&
            prevProps.webhookAuth === nextProps.webhookAuth &&
            prevProps.webhookPrompt === nextProps.webhookPrompt &&
            compareArrays(prevProps.variables, nextProps.variables)
        )
    }
)

export default function TaskModal({
    closeModal: originalCloseModal,
    adding,
    name,
    setName,
    prompt,
    setPrompt,
    variables,
    openVariableModal,
    removeVariable,
    addTask,
    saveTask,
    deleteTask,
    disabled,
    promptInputRef,
    linkInputRef,
    link,
    setLink,
    taskType,
    setTaskType,
    aiModel,
    setAiModel,
    aiTemperature,
    setAiTemperature,
    aiSystemMessage,
    setAiSystemMessage,
    projectId,
    assistantId,
    recurrence = RECURRENCE_NEVER,
    setRecurrence,
    startDate,
    setStartDate,
    sendWhatsApp = false,
    setSendWhatsApp,
    webhookUrl = '',
    setWebhookUrl,
    webhookAuth = '',
    setWebhookAuth,
    webhookPrompt = '',
    setWebhookPrompt,
}) {
    const isMiddleScreen = useSelector(state => state.isMiddleScreen)
    const smallScreenNavigation = useSelector(state => state.smallScreenNavigation)
    const currentAssistant = getAssistantInProjectObject(projectId, assistantId)
    const [showAISettings, setShowAISettings] = useState(false)
    const [showDatePicker, setShowDatePicker] = useState(false)
    const [showTimePicker, setShowTimePicker] = useState(false)
    const [showRecurrenceModal, setShowRecurrenceModal] = useState(false)
    const timeFormat = getTimeFormat()

    console.log('TaskModal render:', {
        adding,
        projectId,
        assistantId,
        currentAssistant,
        aiModel,
        aiTemperature,
        aiSystemMessage,
        assistantInstructions: currentAssistant?.instructions,
        startDateType: typeof startDate,
        startDate,
    })

    console.log('TaskModal render - current startDate:', {
        startDate,
        startDateType: typeof startDate,
        formattedDate: moment(startDate).format('DD.MM.YYYY HH:mm'),
        showDatePicker,
    })

    useEffect(() => {
        if (adding && currentAssistant && !aiSystemMessage) {
            console.log('Setting system message from assistant:', {
                current: aiSystemMessage,
                new: currentAssistant.instructions,
            })
            setAiSystemMessage(currentAssistant.instructions)
        }
    }, [currentAssistant, adding, aiSystemMessage])

    const items = [
        { label: translate('Prompt'), value: TASK_TYPE_PROMPT, marginTop: 0, icon: 'message-square' },
        {
            label: translate('External link'),
            value: TASK_TYPE_EXTERNAL_LINK,
            icon: 'external-link',
        },
        {
            label: translate('Webhook'),
            value: TASK_TYPE_WEBHOOK,
            icon: 'link-2',
        },
    ]

    const nameInputRef = useRef()

    const [width, height] = useWindowSize()

    const checkIfIsValidLink = () => {
        const cleanLink = link.trim()
        return REGEX_URL.test(cleanLink) && !/\s/.test(cleanLink)
    }

    const checkIfIsValidWebhookUrl = () => {
        if (!webhookUrl) return false
        const cleanUrl = webhookUrl.trim()
        return REGEX_URL.test(cleanUrl) && cleanUrl.startsWith('https://')
    }

    const disableButton =
        !name.trim() ||
        (taskType === TASK_TYPE_PROMPT && !prompt.trim()) ||
        (taskType === TASK_TYPE_EXTERNAL_LINK && !checkIfIsValidLink()) ||
        (taskType === TASK_TYPE_WEBHOOK && !checkIfIsValidWebhookUrl())

    // Debug logging for webhook validation
    if (taskType === TASK_TYPE_WEBHOOK) {
        console.log('Webhook validation:', {
            name: name,
            webhookUrl: webhookUrl,
            webhookPrompt: webhookPrompt,
            isValidUrl: checkIfIsValidWebhookUrl(),
            disableButton: disableButton,
        })
    }

    const onPressKey = event => {
        if (disabled) return
        if (event.key === 'Enter') {
            if (!disableButton && !event.shiftKey) {
                event.preventDefault()
                event.stopPropagation()
                adding ? addTask() : saveTask()
            }
        } else if (event.key === 'Tab') {
            event.preventDefault()
            event.stopPropagation()
            if (nameInputRef.current.isFocused()) {
                promptInputRef.current.focus()
            } else if (promptInputRef.current.isFocused()) {
                nameInputRef.current.focus()
            }
        }
    }

    useEffect(() => {
        setTimeout(() => {
            if (nameInputRef && nameInputRef.current) {
                try {
                    nameInputRef.current.focus()
                } catch (error) {
                    console.log('Failed to focus name input:', error)
                }
            }
        }, 100)
    }, [])

    useEffect(() => {
        document.addEventListener('keydown', onPressKey)
        return () => {
            document.removeEventListener('keydown', onPressKey)
        }
    })

    // Memoize callback functions
    const memoizedSetName = useCallback(
        value => {
            console.log('TaskModal - setName called with:', value)
            setName(value)
        },
        [setName]
    )

    const memoizedSetTaskType = useCallback(
        value => {
            console.log('TaskModal - setTaskType called with:', value)
            setTaskType(value)
        },
        [setTaskType]
    )

    const memoizedSetPrompt = useCallback(
        value => {
            console.log('TaskModal - setPrompt called with:', value)
            setPrompt(value)
        },
        [setPrompt]
    )

    const memoizedSetRecurrence = useCallback(
        value => {
            console.log('TaskModal - setRecurrence called with:', value)
            setRecurrence(value)
        },
        [setRecurrence]
    )

    const memoizedSetStartDate = useCallback(value => {
        console.log('TaskModal - setStartDate called with:', value)
        setStartDate(value)
    }, [])

    const memoizedSetShowDatePicker = useCallback(value => {
        console.log('TaskModal - setShowDatePicker called with:', value)
        setShowDatePicker(value)
    }, [])

    const memoizedSetShowTimePicker = useCallback(value => {
        console.log('TaskModal - setShowTimePicker called with:', value)
        setShowTimePicker(value)
    }, [])

    const memoizedSetShowAISettings = useCallback(value => {
        console.log('TaskModal - setShowAISettings called with:', value)
        setShowAISettings(value)
    }, [])

    const memoizedHandleStartTimeChange = useCallback(
        time => {
            console.log('TaskModal - handleStartTimeChange called with:', time)
            const newDate = moment(startDate).hour(moment(time).hour()).minute(moment(time).minute()).valueOf()
            setStartDate(newDate)
            setShowTimePicker(false)
        },
        [startDate, setStartDate, setShowTimePicker]
    )

    const closeModal = (...args) => {
        console.log('closeModal called with args:', args)
        console.trace('closeModal stack trace:')
        originalCloseModal(...args)
    }

    const handleRecurrenceClick = () => {
        setShowRecurrenceModal(true)
    }

    const handleRecurrenceSelect = newRecurrence => {
        console.log('handleRecurrenceSelect called with:', newRecurrence)
        setShowRecurrenceModal(false)
        setRecurrence(newRecurrence)

        // If this is the first time setting recurrence (changing from NEVER),
        // and the start date hasn't been manually set, set it to tomorrow at 9am
        if (recurrence === RECURRENCE_NEVER && newRecurrence !== RECURRENCE_NEVER) {
            const tomorrow = moment().add(1, 'day').startOf('day').hour(9).minute(0)
            setStartDate(tomorrow.valueOf())
        }
    }

    const handleStartDateChange = date => {
        console.log('handleStartDateChange called with:', date)
        const newDate = moment(date).hour(moment(startDate).hour()).minute(moment(startDate).minute()).valueOf()
        setStartDate(newDate)
        setShowDatePicker(false)
    }

    const handleStartTimeChange = time => {
        console.log('handleStartTimeChange called with:', time)
        const newDate = moment(startDate).hour(moment(time).hour()).minute(moment(time).minute()).valueOf()
        setStartDate(newDate)
        setShowTimePicker(false)
    }

    return (
        <div
            onMouseDown={e => {
                const target = e.target
                if (
                    target.closest('.ql-editor') ||
                    target.closest('.ql-toolbar') ||
                    target.closest('.ql-textInputContainer') ||
                    target.closest('.ql-textInputEditor') ||
                    target.closest('[class*="container"]') ||
                    target.closest('.customTextInput3')
                ) {
                    return
                }
                e.preventDefault()
                e.stopPropagation()
            }}
            onClick={e => {
                const target = e.target
                if (
                    target.closest('.ql-editor') ||
                    target.closest('.ql-toolbar') ||
                    target.closest('.ql-textInputContainer') ||
                    target.closest('.ql-textInputEditor') ||
                    target.closest('[class*="container"]') ||
                    target.closest('.customTextInput3')
                ) {
                    return
                }
                e.preventDefault()
                e.stopPropagation()
            }}
            style={{ position: 'relative', zIndex: 1001 }}
        >
            {showRecurrenceModal ? (
                <RecurrenceModal
                    task={{ id: 'temp', recurrence }}
                    projectId={projectId}
                    closePopover={handleRecurrenceSelect}
                />
            ) : (
                <View
                    style={[localStyles.container, applyPopoverWidth(), { maxHeight: height - MODAL_MAX_HEIGHT_GAP }]}
                >
                    <MemoizedModalContent
                        disabled={disabled}
                        nameInputRef={nameInputRef}
                        name={name}
                        setName={memoizedSetName}
                        taskType={taskType}
                        setTaskType={memoizedSetTaskType}
                        items={items}
                        smallScreenNavigation={smallScreenNavigation}
                        isMiddleScreen={isMiddleScreen}
                        promptInputRef={promptInputRef}
                        prompt={prompt}
                        setPrompt={memoizedSetPrompt}
                        variables={variables}
                        openVariableModal={openVariableModal}
                        removeVariable={removeVariable}
                        recurrence={recurrence}
                        setRecurrence={handleRecurrenceClick}
                        projectId={projectId}
                        startDate={startDate}
                        setStartDate={memoizedSetStartDate}
                        showDatePicker={showDatePicker}
                        setShowDatePicker={memoizedSetShowDatePicker}
                        showTimePicker={showTimePicker}
                        setShowTimePicker={memoizedSetShowTimePicker}
                        timeFormat={timeFormat}
                        showAISettings={showAISettings}
                        setShowAISettings={memoizedSetShowAISettings}
                        aiModel={aiModel}
                        setAiModel={setAiModel}
                        aiTemperature={aiTemperature}
                        setAiTemperature={setAiTemperature}
                        aiSystemMessage={aiSystemMessage}
                        setAiSystemMessage={setAiSystemMessage}
                        link={link}
                        setLink={setLink}
                        linkInputRef={linkInputRef}
                        checkIfIsValidLink={checkIfIsValidLink}
                        adding={adding}
                        addTask={addTask}
                        saveTask={saveTask}
                        deleteTask={deleteTask}
                        disableButton={disableButton}
                        closeModal={closeModal}
                        handleStartTimeChange={memoizedHandleStartTimeChange}
                        sendWhatsApp={sendWhatsApp}
                        setSendWhatsApp={setSendWhatsApp}
                        webhookUrl={webhookUrl}
                        setWebhookUrl={setWebhookUrl}
                        webhookAuth={webhookAuth}
                        setWebhookAuth={setWebhookAuth}
                        webhookPrompt={webhookPrompt}
                        setWebhookPrompt={setWebhookPrompt}
                    />
                </View>
            )}
        </div>
    )
}

const localStyles = StyleSheet.create({
    container: {
        backgroundColor: colors.Secondary400,
        borderRadius: 4,
        width: 305,
        shadowColor: 'rgba(78, 93, 120, 0.56)',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 1,
        shadowRadius: 16,
        elevation: 3,
    },
    scroll: {
        paddingTop: 16,
        paddingLeft: 16,
        paddingRight: 16,
        paddingBottom: 16,
    },
    advancedSettingsButton: {
        marginTop: 8,
        marginBottom: 4,
        alignItems: 'center',
        justifyContent: 'center',
        width: '100%',
    },
    advancedSettingsText: {
        fontSize: 14,
        fontWeight: '500',
        color: colors.Text02,
        textAlign: 'center',
    },
    disabledText: {
        opacity: 0.5,
    },
    recurrenceContainer: {
        marginTop: 16,
        flexDirection: 'row',
        alignItems: 'center',
    },
    dateButton: {
        backgroundColor: colors.Secondary300,
        paddingHorizontal: 12,
        paddingVertical: 8,
        borderRadius: 4,
    },
    timePickerContainer: {
        backgroundColor: colors.Secondary400,
        borderRadius: 4,
        padding: 8,
        maxHeight: 300,
        overflow: 'auto',
    },
    timeOption: {
        padding: 8,
        borderRadius: 4,
    },
    selectedTimeOption: {
        backgroundColor: colors.Primary500,
    },
    checkboxContainer: {
        width: 24,
        height: 24,
        borderRadius: 4,
        borderWidth: 2,
        borderColor: colors.Text03,
        backgroundColor: 'transparent',
        alignItems: 'center',
        justifyContent: 'center',
    },
    checkboxActive: {
        backgroundColor: colors.Secondary300,
        borderColor: colors.Primary500,
    },
})
