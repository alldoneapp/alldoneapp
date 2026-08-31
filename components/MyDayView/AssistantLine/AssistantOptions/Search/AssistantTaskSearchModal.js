import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Image, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native'
import { useDispatch, useSelector } from 'react-redux'

import { getPreConfigTasksForAllProjects } from '../../../../../utils/backends/Assistants/assistantsFirestore'
import { generateTaskFromPreConfig } from '../../../../../utils/assistantHelper'
import { setIframeModalData, setPreConfigTaskExecuting } from '../../../../../redux/actions'
import useWindowSize from '../../../../../utils/useWindowSize'
import { applyPopoverWidth } from '../../../../../utils/HelperFunctions'
import CustomScrollView from '../../../../UIControls/CustomScrollView'
import Button from '../../../../UIControls/Button'
import ModalHeader from '../../../../UIComponents/FloatModals/ModalHeader'
import PreConfigTaskGeneratorModal from '../../../../UIComponents/FloatModals/PreConfigTaskGeneratorModal/PreConfigTaskGeneratorModal'
import RunOutOfGoldAssistantModal from '../../../../ChatsView/ChatDV/EditorView/BotOption/RunOutOfGoldAssistantModal'
import EmptyMatch from '../../../../Feeds/CommentsTextInput/MentionsModal/EmptyMatch'
import ColoredCircleSmall from '../../../../SidebarMenu/ProjectFolding/ProjectItem/ColoredCircleSmall'
import AssistantAvatar from '../../../../AdminPanel/Assistants/AssistantAvatar'
import Icon from '../../../../Icon'
import styles, { colors } from '../../../../styles/global'
import { translate } from '../../../../../i18n/TranslationService'
import {
    TASK_TYPE_EXTERNAL_LINK,
    TASK_TYPE_IFRAME,
    TASK_TYPE_PROMPT,
    TASK_TYPE_WEBHOOK,
} from '../../../../UIComponents/FloatModals/PreConfigTaskModal/TaskModal'
import { filterPreConfigTaskSearchItems, groupPreConfigTaskSearchItems } from './assistantTaskSearchHelper'
import { getAssistantTaskIcon } from '../assistantTaskIcon'
import { getSafeAreaModalMaxHeight } from '../../../../../utils/modalSafeArea'

const getAiSettings = task => {
    return task.aiModel || task.aiReasoningEffort !== undefined || task.aiSystemMessage
        ? {
              model: task.aiModel,
              reasoningEffort: task.aiReasoningEffort,
              systemMessage: task.aiSystemMessage,
          }
        : null
}

const getTaskMetadata = task => ({
    ...(task.taskMetadata || {}),
    sendWhatsApp: !!task.sendWhatsApp,
    executionMode: task.executionMode,
})

export default function AssistantTaskSearchModal({ closeModal }) {
    const dispatch = useDispatch()
    const gold = useSelector(state => state.loggedUser.gold)
    const isMobile = useSelector(state => state.smallScreenNavigation)
    const [width, height] = useWindowSize()
    const inputRef = useRef(null)
    const activeIndexRef = useRef(0)
    const executingTaskRef = useRef(false)
    const mountedRef = useRef(false)
    const [tasks, setTasks] = useState([])
    const [searchText, setSearchText] = useState('')
    const [loading, setLoading] = useState(true)
    const [loadError, setLoadError] = useState(null)
    const [activeIndex, setActiveIndex] = useState(0)
    const [selectedTask, setSelectedTask] = useState(null)
    const [runOutOfGold, setRunOutOfGold] = useState(false)

    const filteredTasks = useMemo(() => filterPreConfigTaskSearchItems(tasks, searchText), [tasks, searchText])
    const groupedTasks = useMemo(() => groupPreConfigTaskSearchItems(filteredTasks), [filteredTasks])

    const selectTask = task => {
        if (!task || executingTaskRef.current) return

        if (gold <= 0 && task.type !== TASK_TYPE_EXTERNAL_LINK && task.type !== TASK_TYPE_IFRAME) {
            setRunOutOfGold(true)
            return
        }

        if (task.type === TASK_TYPE_PROMPT) {
            if ((task.variables || []).length > 0) {
                setSelectedTask(task)
            } else {
                executingTaskRef.current = true
                closeModal()
                dispatch(setPreConfigTaskExecuting(task.name))
                generateTaskFromPreConfig(
                    task.projectId,
                    task.name,
                    task.assistantId,
                    task.prompt,
                    getAiSettings(task),
                    getTaskMetadata(task),
                    { skipNavigation: true }
                )
            }
        } else if (task.type === TASK_TYPE_WEBHOOK) {
            executingTaskRef.current = true
            closeModal()
            dispatch(setPreConfigTaskExecuting(task.name))
            generateTaskFromPreConfig(
                task.projectId,
                task.name,
                task.assistantId,
                task.prompt,
                getAiSettings(task),
                getTaskMetadata(task),
                { skipNavigation: true }
            )
        } else if (task.type === TASK_TYPE_IFRAME) {
            executingTaskRef.current = true
            closeModal()
            dispatch(setIframeModalData(true, task.link, task.name))
        } else {
            executingTaskRef.current = true
            closeModal()
            window.open(task.link, '_blank')
        }
    }

    const loadTasks = useCallback(async () => {
        if (!mountedRef.current) return
        setLoading(true)
        setLoadError(null)
        try {
            const result = await getPreConfigTasksForAllProjects()
            if (mountedRef.current) setTasks(result)
        } catch (error) {
            console.error('Error loading assistant pre-configured tasks:', error)
            if (mountedRef.current) {
                setTasks([])
                setLoadError(error)
            }
        } finally {
            if (mountedRef.current) setLoading(false)
        }
    }, [])

    useEffect(() => {
        mountedRef.current = true
        loadTasks()

        const focusTimer = setTimeout(() => inputRef.current?.focus?.(), 0)
        return () => {
            mountedRef.current = false
            clearTimeout(focusTimer)
        }
    }, [loadTasks])

    useEffect(() => {
        const newIndex = filteredTasks.length > 0 ? Math.min(activeIndexRef.current, filteredTasks.length - 1) : -1
        activeIndexRef.current = newIndex
        setActiveIndex(newIndex)
    }, [filteredTasks.length])

    useEffect(() => {
        const onKeyDown = event => {
            if (selectedTask || runOutOfGold) return

            if (event.key === 'ArrowDown' && filteredTasks.length > 0) {
                event.preventDefault()
                event.stopPropagation()
                const nextIndex = activeIndexRef.current + 1 >= filteredTasks.length ? 0 : activeIndexRef.current + 1
                activeIndexRef.current = nextIndex
                setActiveIndex(nextIndex)
            } else if (event.key === 'ArrowUp' && filteredTasks.length > 0) {
                event.preventDefault()
                event.stopPropagation()
                const nextIndex = activeIndexRef.current <= 0 ? filteredTasks.length - 1 : activeIndexRef.current - 1
                activeIndexRef.current = nextIndex
                setActiveIndex(nextIndex)
            } else if (event.key === 'Enter' && activeIndexRef.current >= 0) {
                event.preventDefault()
                event.stopPropagation()
                selectTask(filteredTasks[activeIndexRef.current])
            } else if (event.key === 'Escape') {
                event.preventDefault()
                event.stopPropagation()
                closeModal()
            }
        }

        document.addEventListener('keydown', onKeyDown)
        return () => document.removeEventListener('keydown', onKeyDown)
    }, [filteredTasks, selectedTask, runOutOfGold])

    if (runOutOfGold) {
        return <RunOutOfGoldAssistantModal closeModal={() => setRunOutOfGold(false)} />
    }

    if (selectedTask) {
        return (
            <PreConfigTaskGeneratorModal
                projectId={selectedTask.projectId}
                closeModal={() => {
                    setSelectedTask(null)
                    closeModal()
                }}
                task={selectedTask}
                assistant={selectedTask.assistant}
            />
        )
    }

    const widerPopoverStyle = isMobile
        ? applyPopoverWidth()
        : (() => {
              const modalWidth = Math.max(Math.min(width - 32, 520), 304)
              return { width: modalWidth, minWidth: modalWidth, maxWidth: modalWidth }
          })()

    return (
        <View style={[localStyles.container, widerPopoverStyle, { maxHeight: getSafeAreaModalMaxHeight(height) }]}>
            <ModalHeader closeModal={closeModal} title={translate('Search assistant tasks')} />
            <View style={localStyles.searchBox}>
                <Icon name="search" size={18} color={colors.Text03} />
                <TextInput
                    ref={inputRef}
                    value={searchText}
                    onChangeText={setSearchText}
                    placeholder={translate('Search pre-configured tasks')}
                    placeholderTextColor={colors.Text03}
                    style={localStyles.input}
                    underlineColorAndroid="transparent"
                    autoCorrect={false}
                />
            </View>
            <CustomScrollView
                style={localStyles.scroll}
                containerStyle={localStyles.scrollContainer}
                contentContainerStyle={localStyles.scrollContent}
                indicatorStyle={localStyles.scrollIndicator}
                showsVerticalScrollIndicator={false}
            >
                {loadError ? (
                    <View style={localStyles.errorState}>
                        <EmptyMatch showSpinner={false} text={translate('Could not load assistant tasks')} />
                        <Button
                            type={'primary'}
                            title={translate('Try again')}
                            onPress={loadTasks}
                            buttonStyle={localStyles.retryButton}
                        />
                    </View>
                ) : filteredTasks.length > 0 ? (
                    <GroupedResults
                        groupedTasks={groupedTasks}
                        activeTask={filteredTasks[activeIndex]}
                        onPress={selectTask}
                    />
                ) : (
                    <EmptyMatch showSpinner={loading} text={translate('No assistant tasks found')} />
                )}
            </CustomScrollView>
        </View>
    )
}

function GroupedResults({ groupedTasks, activeTask, onPress }) {
    return groupedTasks.map(projectGroup => {
        const amount = projectGroup.assistants.reduce((total, assistantGroup) => total + assistantGroup.tasks.length, 0)
        return (
            <View key={projectGroup.project.id}>
                <ProjectHeader project={projectGroup.project} amount={amount} />
                {projectGroup.assistants.map(assistantGroup => (
                    <AssistantGroup
                        key={assistantGroup.assistant.uid}
                        assistantGroup={assistantGroup}
                        activeTask={activeTask}
                        onPress={onPress}
                    />
                ))}
            </View>
        )
    })
}

function ProjectHeader({ project, amount }) {
    return (
        <View style={localStyles.projectHeader}>
            {project.color ? (
                <ColoredCircleSmall
                    size={16}
                    color={project.color}
                    isGuide={!!project.parentTemplateId}
                    containerStyle={{ marginHorizontal: 4 }}
                    projectId={project.id}
                />
            ) : (
                <View style={[localStyles.colorDot, { backgroundColor: colors.Text03 }]} />
            )}
            <Text style={localStyles.projectName} numberOfLines={1}>
                {project.name}
            </Text>
            <View style={localStyles.badge}>
                <Text style={localStyles.badgeText}>{amount}</Text>
            </View>
        </View>
    )
}

function AssistantGroup({ assistantGroup, activeTask, onPress }) {
    const { assistant, tasks } = assistantGroup
    return (
        <View style={localStyles.assistantGroup}>
            <View style={localStyles.assistantHeader}>
                <AssistantAvatar
                    photoURL={assistant.photoURL50 || assistant.photoURL300 || assistant.photoURL}
                    assistantId={assistant.uid}
                    size={24}
                />
                <Text style={localStyles.assistantName} numberOfLines={1}>
                    {assistant.displayName || assistant.name}
                </Text>
            </View>
            {tasks.map(task => (
                <TaskRow
                    key={task.searchId || `${task.projectId}_${task.assistantId}_${task.id}`}
                    task={task}
                    active={activeTask?.searchId === task.searchId}
                    onPress={onPress}
                />
            ))}
        </View>
    )
}

function TaskRow({ task, active, onPress }) {
    return (
        <TouchableOpacity
            style={[localStyles.taskRow, active && localStyles.activeTaskRow]}
            onPress={() => onPress(task)}
        >
            <Icon name={getAssistantTaskIcon(task)} size={20} color="#ffffff" />
            <Text style={localStyles.taskName} numberOfLines={2}>
                {task.name}
            </Text>
            <View style={localStyles.avatarWrapper}>
                {task.assistant?.photoURL50 || task.assistant?.photoURL300 || task.assistant?.photoURL ? (
                    <Image
                        source={{
                            uri: task.assistant.photoURL50 || task.assistant.photoURL300 || task.assistant.photoURL,
                        }}
                        style={localStyles.avatar}
                    />
                ) : (
                    <AssistantAvatar assistantId={task.assistantId} size={24} />
                )}
            </View>
        </TouchableOpacity>
    )
}

const localStyles = StyleSheet.create({
    container: {
        backgroundColor: colors.Secondary400,
        borderRadius: 4,
        boxShadow: '0px 4px 16px rgba(78,93,120,0.56)',
        elevation: 3,
        paddingTop: 16,
        paddingHorizontal: 16,
        paddingBottom: 12,
    },
    searchBox: {
        height: 40,
        borderRadius: 4,
        borderWidth: 1,
        borderColor: colors.Primary200,
        backgroundColor: colors.Secondary300,
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 10,
        marginBottom: 12,
    },
    input: {
        ...styles.body1,
        color: '#ffffff',
        flex: 1,
        marginLeft: 8,
        outlineStyle: 'none',
    },
    scroll: {
        maxHeight: 424,
    },
    scrollContainer: {
        marginRight: -8,
    },
    scrollContent: {
        paddingRight: 28,
        paddingBottom: 8,
    },
    scrollIndicator: {
        right: 8,
    },
    errorState: {
        alignItems: 'center',
        paddingBottom: 16,
    },
    retryButton: {
        marginTop: 12,
    },
    projectHeader: {
        height: 40,
        flexDirection: 'row',
        alignItems: 'flex-end',
        borderBottomColor: colors.Grey400,
        borderBottomWidth: 1,
        paddingBottom: 4,
        marginTop: 8,
    },
    colorDot: {
        width: 16,
        height: 16,
        borderRadius: 8,
        marginHorizontal: 4,
    },
    projectName: {
        ...styles.subtitle2,
        color: '#ffffff',
        flex: 1,
        paddingLeft: 8,
    },
    badge: {
        backgroundColor: colors.Primary200,
        borderRadius: 10,
        paddingHorizontal: 6,
        paddingVertical: 2,
        minWidth: 20,
        alignItems: 'center',
    },
    badgeText: {
        ...styles.caption2,
        color: colors.Text03,
    },
    assistantGroup: {
        marginTop: 8,
    },
    assistantHeader: {
        height: 32,
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 8,
    },
    assistantName: {
        ...styles.subtitle2,
        color: colors.Text03,
        marginLeft: 8,
        flex: 1,
    },
    taskRow: {
        minHeight: 48,
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 8,
        paddingVertical: 8,
        borderRadius: 4,
    },
    activeTaskRow: {
        backgroundColor: colors.Primary300,
        borderWidth: 2,
        borderColor: colors.UtilityBlue150,
        borderStyle: 'dashed',
    },
    taskName: {
        ...styles.subtitle1,
        color: '#ffffff',
        flex: 1,
        marginLeft: 8,
    },
    avatarWrapper: {
        width: 24,
        height: 24,
        borderRadius: 12,
        overflow: 'hidden',
        marginLeft: 8,
    },
    avatar: {
        width: 24,
        height: 24,
        borderRadius: 12,
    },
})
