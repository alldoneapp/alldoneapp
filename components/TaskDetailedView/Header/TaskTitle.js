import React, { Component } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import styles, { colors } from '../../styles/global'
import Backend from '../../../utils/BackendBridge'
import SocialTextInput from '../../SocialTextInput'
import store from '../../../redux/store'
import { setTaskTitleInEditMode } from '../../../redux/actions'
import { DV_TAB_TASK_CHAT, DV_TAB_TASK_NOTE } from '../../../utils/TabNavigationConstants'
import ProjectHelper from '../../SettingsView/ProjectsSettings/ProjectHelper'
import { TASK_ASSIGNEE_ASSISTANT_TYPE } from '../../TaskListView/Utils/TasksHelper'
import { setTaskName } from '../../../utils/backends/Tasks/tasksFirestore'

export const TITLE_TASK = 0
export const TITLE_NOTE = 2

class TaskTitle extends Component {
    constructor(props) {
        super(props)
        const storeState = store.getState()

        this.state = {
            taskTitle: this.props.title,
            selectedTab: storeState.selectedNavItem,
            taskTitleInEditMode: storeState.taskTitleInEditMode,
            unsubscribe: store.subscribe(this.updateState),
        }
    }

    getMaxHeight = () => {
        const { taskTitleInEditMode, selectedTab } = this.state
        return (selectedTab === DV_TAB_TASK_CHAT || selectedTab === DV_TAB_TASK_NOTE) && !taskTitleInEditMode ? 70 : 800
    }

    componentDidUpdate(prevProps) {
        const { title } = this.props
        if (prevProps.title !== title) {
            this.setState({ taskTitle: title })
        }
    }

    componentWillUnmount() {
        this.state.unsubscribe()
    }

    onTitleLayoutChange = ({ nativeEvent }) => {
        const maxHeight = this.getMaxHeight()
        const { layout } = nativeEvent

        if (layout.height > maxHeight && !this.state.showEllipsis) {
            this.setState({ showEllipsis: true })
        } else if (layout.height <= maxHeight && this.state.showEllipsis) {
            this.setState({ showEllipsis: false })
        }
    }

    render() {
        const { taskTitleInEditMode, taskTitle, showEllipsis } = this.state
        const { projectId, task, titleType, onSubmit, object, numberOfLines } = this.props
        const { uid } = store.getState().loggedUser
        const maxHeight = this.getMaxHeight()

        const loggedUserIsTaskOwner = task.userId === uid
        const loggedUserCanUpdateObject =
            loggedUserIsTaskOwner || !ProjectHelper.checkIfLoggedUserIsNormalUserInGuide(projectId)

        const isAssistant = task.assigneeType === TASK_ASSIGNEE_ASSISTANT_TYPE

        return (
            <View style={[localStyles.titleContainer, { maxHeight: maxHeight }]}>
                <View style={localStyles.upperContainer} />
                <View style={[localStyles.bottomContainer, { top: taskTitleInEditMode ? -4 : 0 }]}>
                    <View
                        style={{
                            flex: 1,
                            marginRight: taskTitleInEditMode ? 0 : 16,
                        }}
                        onLayout={this.onTitleLayoutChange}
                        pointerEvents={loggedUserCanUpdateObject ? 'auto' : 'none'}
                    >
                        <SocialTextInput
                            key={taskTitle}
                            isFocused={taskTitleInEditMode}
                            onFocus={() => store.dispatch(setTaskTitleInEditMode(true))}
                            value={taskTitle}
                            onSubmitEditing={value => {
                                if (onSubmit != null) {
                                    onSubmit(value)
                                } else {
                                    setTaskName(projectId, task.id, value, task, taskTitle)
                                }
                                this.setState({ taskTitle: value })
                            }}
                            normalStyle={[styles.title4, { color: colors.Text01, whiteSpace: 'pre' }]}
                            hashtagStyle={styles.title6}
                            mentionStyle={styles.title6}
                            emailStyle={styles.title6}
                            linkStyle={styles.title6}
                            projectId={projectId}
                            task={task}
                            inTaskDetailedView={true}
                            titleType={titleType}
                            objectId={object.id}
                            object={object}
                            numberOfLines={numberOfLines}
                            disabled={isAssistant}
                        />
                    </View>
                </View>
                {showEllipsis && !taskTitleInEditMode && <Text style={localStyles.ellipsis}>...</Text>}
            </View>
        )
    }

    updateState = () => {
        const storeState = store.getState()
        this.setState({
            selectedTab: storeState.selectedNavItem,
            taskTitleInEditMode: storeState.taskTitleInEditMode,
        })
    }
}

TaskTitle.defaultProps = {
    titleType: TITLE_TASK,
}

export default TaskTitle

const localStyles = StyleSheet.create({
    titleContainer: {
        flex: 1,
        minHeight: 64,
        maxHeight: 800,
        overflowY: 'hidden',
    },
    upperContainer: {
        height: 32,
        backgroundColor: 'white',
    },
    bottomContainer: {
        flexDirection: 'row',
        backgroundColor: 'white',
        minHeight: 32,
        // maxHeight: 64,
        overflow: 'hidden',
        justifyContent: 'flex-start',
        alignItems: 'flex-start',
        alignContent: 'flex-start',
    },
    ellipsis: {
        ...styles.title4,
        color: colors.Text01,
        backgroundColor: '#ffffff',
        paddingHorizontal: 8,
        position: 'absolute',
        bottom: 0,
        right: 0,
    },
})
