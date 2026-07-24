import React, { Component } from 'react'
import { Image, StyleSheet, View } from 'react-native'
import { colors } from '../../styles/global'
import store from '../../../redux/store'
import Button from '../../UIControls/Button'
import Popover from 'react-tiny-popover'
import AssigneePickerModal from '../../UIComponents/FloatModals/AssigneePickerModal/AssigneePickerModal'
import ProjectHelper from '../../SettingsView/ProjectsSettings/ProjectHelper'
import Backend from '../../../utils/BackendBridge'
import { setAssignee } from '../../../redux/actions'
import AssigneeAndObserversModal from '../../UIComponents/FloatModals/AssigneeAndObserversModal/AssigneeAndObserversModal'
import SVGGenericUser from '../../../assets/svg/SVGGenericUser'
import { WORKSTREAM_ID_PREFIX } from '../../Workstreams/WorkstreamHelper'
import Icon from '../../Icon'
import { TASK_ASSIGNEE_ASSISTANT_TYPE } from '../../TaskListView/Utils/TasksHelper'
import ObserversModal from '../../UIComponents/FloatModals/AssigneeAndObserversModal/ObserversModal'
import { setTaskAssigneeAndObservers } from '../../../utils/backends/Tasks/tasksFirestore'

export default class Assignee extends Component {
    constructor(props) {
        super(props)
        const storeState = store.getState()

        this.state = {
            visiblePopover: false,
            assignee: storeState.assignee,
            loggedUser: storeState.loggedUser,
            smallScreen: storeState.smallScreen,
            unsubscribe: store.subscribe(this.updateState),
        }

        this.buttonRef = React.createRef()
    }

    componentWillUnmount() {
        this.state.unsubscribe()
    }

    hidePopover = () => {
        this.setState({ visiblePopover: false })
    }

    showPopover = () => {
        /* istanbul ignore next */
        this.setState({ visiblePopover: true })
        this.buttonRef?.current?.blur()
    }

    onSelectUser = (user, observers) => {
        const { projectId, task } = this.props

        setTaskAssigneeAndObservers(projectId, task.id, user.uid, observers, this.state.assignee, user, task, true)
        store.dispatch(setAssignee(user))
        this.hidePopover()
    }

    getUserName = () => {
        const { assignee } = this.state
        return assignee.displayName
            ? assignee?.uid?.startsWith(WORKSTREAM_ID_PREFIX)
                ? assignee.displayName
                : assignee.displayName.trim().split(' ')[0]
            : 'Loading...'
    }

    render() {
        const { visiblePopover, assignee, smallScreen } = this.state
        const { projectId, task, disabled } = this.props

        const projectIndex = ProjectHelper.getProjectIndexById(projectId)
        const disableAssigneePicker = disabled || task.done

        const isAssistant = task.assigneeType === TASK_ASSIGNEE_ASSISTANT_TYPE

        return (
            <Popover
                content={
                    isAssistant ? (
                        <ObserversModal
                            projectIndex={projectIndex}
                            task={task}
                            onSaveData={this.onSelectUser}
                            closePopover={this.hidePopover}
                            delayClosePopover={this.hidePopover}
                        />
                    ) : (
                        <AssigneeAndObserversModal
                            projectIndex={projectIndex}
                            object={task}
                            onSaveData={this.onSelectUser}
                            closePopover={this.hidePopover}
                            delayClosePopover={this.hidePopover}
                        />
                    )
                }
                onClickOutside={this.hidePopover}
                isOpen={visiblePopover}
                position={['bottom', 'left', 'right', 'top']}
                padding={4}
                align={'end'}
                contentLocation={smallScreen ? null : undefined}
            >
                <Button
                    ref={this.buttonRef}
                    type={'ghost'}
                    icon={
                        assignee?.uid?.startsWith(WORKSTREAM_ID_PREFIX) ? (
                            <Icon size={24} name="workstream" color={colors.Text03} />
                        ) : assignee.photoURL != null && assignee.photoURL !== '' ? (
                            <Image style={localStyles.userImage} source={{ uri: assignee.photoURL }} />
                        ) : (
                            <View style={[localStyles.userImage, { overflow: 'hidden' }]}>
                                <SVGGenericUser width={24} height={24} svgid={`ci_p_${assignee.uid}_${projectIndex}`} />
                            </View>
                        )
                    }
                    title={this.getUserName()}
                    onPress={this.showPopover}
                    disabled={disableAssigneePicker}
                />
            </Popover>
        )
    }

    updateState = () => {
        const storeState = store.getState()

        this.setState({
            assignee: storeState.assignee,
            loggedUser: storeState.loggedUser,
            smallScreen: storeState.smallScreen,
        })
    }
}

const localStyles = StyleSheet.create({
    container: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 16,
        height: 40,
        borderWidth: 1,
        borderColor: colors.Gray400,
        borderRadius: 4,
    },
    userImage: {
        width: 24,
        height: 24,
        borderRadius: 100,
    },
})
