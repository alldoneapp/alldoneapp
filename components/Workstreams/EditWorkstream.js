import React, { Component } from 'react'
import { Keyboard, StyleSheet, View } from 'react-native'
import { cloneDeep, isEqual } from 'lodash'
import Icon from '../Icon'
import store from '../../redux/store'
import { colors } from '../styles/global'
import CustomTextInput3 from '../Feeds/CommentsTextInput/CustomTextInput3'
import { GOAL_THEME } from '../Feeds/CommentsTextInput/textInputHelper'
import { getNewDefaultWorkstream, setWorkstreamLastVisitedBoardDate } from './WorkstreamHelper'
import CancelButton from '../GoalsView/EditGoalsComponents/CancelButton'
import DoneButton from '../GoalsView/EditGoalsComponents/DoneButton'
import MembersWrapper from './EditWorkstreamsComponents/MembersWrapper'
import DescriptionWrapper from './EditWorkstreamsComponents/DescriptionWrapper'
import Hotkeys from 'react-hot-keys'
import { execShortcutFn } from '../../utils/HelperFunctions'
import Button from '../UIControls/Button'
import {
    setSelectedSidebarTab,
    setSelectedTypeOfProject,
    showConfirmPopup,
    showFloatPopup,
    storeCurrentUser,
} from '../../redux/actions'
import { CONFIRM_POPUP_TRIGGER_DELETE_WORKSTREAM } from '../UIComponents/ConfirmPopup'
import { translate } from '../../i18n/TranslationService'
import { DV_TAB_ROOT_TASKS } from '../../utils/TabNavigationConstants'
import NavigationService from '../../utils/NavigationService'
import ProjectHelper from '../SettingsView/ProjectsSettings/ProjectHelper'
import SharedHelper from '../../utils/SharedHelper'
import { updateWorkstream, uploadNewWorkstream } from '../../utils/backends/Workstreams/workstreamsFirestore'

export default class EditWorkstream extends Component {
    constructor(props) {
        super(props)

        const { smallScreen, isMiddleScreen, smallScreenNavigation, loggedUser } = store.getState()

        const { adding, stream, projectId } = this.props
        const tmpStream = adding ? getNewDefaultWorkstream(projectId, loggedUser.uid) : cloneDeep(stream)

        this.state = {
            tmpStream,
            smallScreen: smallScreen,
            isMiddleScreen: isMiddleScreen,
            smallScreenNavigation: smallScreenNavigation,
            loggedUser: loggedUser,
            unsubscribe: store.subscribe(this.updateState),
        }
    }

    updateState = () => {
        const { smallScreen, isMiddleScreen, smallScreenNavigation, loggedUser } = store.getState()
        this.setState({
            loggedUser,
            smallScreen,
            isMiddleScreen,
            smallScreenNavigation,
        })
    }

    componentDidMount() {
        this.updateState()
        document.addEventListener('keydown', this.onKeyDown)
    }

    componentWillUnmount() {
        document.removeEventListener('keydown', this.onKeyDown)
        this.state.unsubscribe()
    }

    enterKeyAction = () => {
        if (store.getState().showFloatPopup === 0) {
            this.actionDoneButton()
        }
    }

    onKeyDown = event => {
        const { key } = event
        if (key === 'Enter') {
            this.enterKeyAction()
        }
    }

    setName = displayName => {
        const { tmpStream } = this.state
        tmpStream.displayName = displayName
        this.setState({ tmpStream })
    }

    actionDoneButton = () => {
        const { adding } = this.props
        const { tmpStream } = this.state
        const needUpdate = this.needBeUpdated()

        if (needUpdate) {
            adding ? this.createWorkstream(tmpStream, true) : this.updateWs(tmpStream, true)
        }
    }

    updateWs = (tmpStream, needToCancelAction) => {
        const { projectId, onCancelAction, stream } = this.props
        updateWorkstream(projectId, tmpStream, stream)
        if (needToCancelAction) {
            onCancelAction()
        }
    }

    createWorkstream = (tmpStream, needToCancelAction) => {
        const { projectId, onCancelAction } = this.props
        uploadNewWorkstream(projectId, tmpStream)
        if (needToCancelAction) onCancelAction()
    }

    needBeUpdated = () => {
        const { adding, stream } = this.props
        const { tmpStream } = this.state
        const { displayName } = tmpStream

        const cleanedName = displayName.trim()

        if (!cleanedName) {
            return false
        }

        return adding || cleanedName !== stream.displayName.trim()
    }

    updateMembers = userIds => {
        const { tmpStream } = this.state
        if (!isEqual(tmpStream.userIds, userIds)) {
            const { adding } = this.props
            tmpStream.userIds = userIds
            adding ? this.createWorkstream(tmpStream, true) : this.updateWs(tmpStream, true)
        }
    }

    updateDescription = description => {
        const { tmpStream } = this.state
        const { adding } = this.props
        adding
            ? this.createWorkstream({ ...tmpStream, description }, true)
            : this.updateWs({ ...tmpStream, description }, true)
    }

    deleteStream = () => {
        const { projectId, stream } = this.props
        Keyboard.dismiss()
        store.dispatch([
            showFloatPopup(),
            showConfirmPopup({
                trigger: CONFIRM_POPUP_TRIGGER_DELETE_WORKSTREAM,
                object: {
                    projectId: projectId,
                    stream: stream,
                    headerText: 'Be careful, this action is permanent',
                    headerQuestion: 'Do you really want to delete this workstream?',
                },
            }),
        ])
    }

    openDetailedView = () => {
        const { projectId } = this.props
        const { tmpStream, loggedUser } = this.state
        const projectType = ProjectHelper.getTypeOfProject(loggedUser, projectId)

        setWorkstreamLastVisitedBoardDate(projectId, tmpStream, 'lastVisitBoard')

        store.dispatch([
            setSelectedSidebarTab(DV_TAB_ROOT_TASKS),
            storeCurrentUser(tmpStream),
            setSelectedTypeOfProject(projectType),
        ])
        NavigationService.navigate('Root')
    }

    render() {
        const { smallScreen, smallScreenNavigation, tmpStream, loggedUser } = this.state
        const { onCancelAction, style, projectId, stream, projectIndex, adding } = this.props
        const needUpdate = this.needBeUpdated()
        const accessGranted = SharedHelper.accessGranted(loggedUser, projectId)

        return (
            <View
                style={[localStyles.container, smallScreenNavigation && localStyles.containerUnderBreakpoint, style]}
                data-edit-workstream={`${adding ? 'new-workstream' : stream.uid}`}
            >
                <View style={[localStyles.inputContainer, !adding && localStyles.inputContainerEdit]}>
                    <Icon
                        style={[localStyles.icon, smallScreenNavigation && localStyles.iconMobile]}
                        name={adding ? 'plus-square' : 'workstream'}
                        size={24}
                        color={adding ? colors.Primary100 : colors.Text03}
                    />
                    <CustomTextInput3
                        placeholder={translate(
                            adding ? 'Type to add a workstream' : 'Write the title of the workstream'
                        )}
                        onChangeText={this.setName}
                        autoFocus={true}
                        disabledTags={true}
                        projectId={projectId}
                        styleTheme={GOAL_THEME}
                        initialTextExtended={tmpStream.displayName}
                        disabledEdition={!accessGranted}
                        containerStyle={localStyles.textInputContainer}
                        forceTriggerEnterActionForBreakLines={this.enterKeyAction}
                    />
                </View>
                <View style={localStyles.buttonContainer}>
                    <View style={[localStyles.buttonSection]}>
                        <View style={{ marginRight: 32 }}>
                            <Hotkeys
                                keyName={'alt+O'}
                                disabled={adding}
                                onKeyDown={(sht, event) =>
                                    execShortcutFn(this.openBtnRef, () => this.openDetailedView(), event)
                                }
                                filter={e => true}
                            >
                                <Button
                                    ref={ref => (this.openBtnRef = ref)}
                                    title={smallScreen ? null : translate('Open nav')}
                                    type={'secondary'}
                                    noBorder={smallScreen}
                                    icon={'maximize-2'}
                                    onPress={() => this.openDetailedView()}
                                    disabled={adding}
                                    shortcutText={'O'}
                                />
                            </Hotkeys>
                        </View>

                        {accessGranted && (
                            <>
                                <DescriptionWrapper
                                    stream={tmpStream}
                                    updateDescription={this.updateDescription}
                                    projectId={projectId}
                                    closeEditModal={onCancelAction}
                                />
                                <MembersWrapper
                                    stream={tmpStream}
                                    updateMembers={adding ? this.updateMembers : null}
                                    projectIndex={projectIndex}
                                    projectId={projectId}
                                    closeEditModal={onCancelAction}
                                />
                                {!adding && (
                                    <Hotkeys
                                        keyName={'alt+Del'}
                                        onKeyDown={(sht, event) =>
                                            execShortcutFn(this.delBtnRef.current, this.deleteStream, event)
                                        }
                                        filter={e => true}
                                    >
                                        <Button
                                            ref={this.delBtnRef}
                                            type={'ghost'}
                                            icon={'trash-2'}
                                            noBorder={smallScreen}
                                            onPress={this.deleteStream}
                                            accessible={false}
                                            shortcutText={'Del'}
                                        />
                                    </Hotkeys>
                                )}
                            </>
                        )}
                    </View>
                    <View style={[localStyles.buttonSection, localStyles.buttonSectionRight]}>
                        <CancelButton onCancelAction={onCancelAction} />
                        <DoneButton
                            needUpdate={needUpdate}
                            adding={adding}
                            actionDoneButton={() => {
                                this.actionDoneButton()
                            }}
                            disabled={!accessGranted}
                        />
                    </View>
                </View>
            </View>
        )
    }
}

const localStyles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: '#ffffff',
        borderWidth: 1,
        borderStyle: 'solid',
        borderColor: colors.Grey200,
        borderRadius: 4,
        shadowColor: 'rgba(0,0,0,0.08)',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 1,
        shadowRadius: 8,
        elevation: 3,
        marginLeft: -16,
        marginRight: -16,
        marginBottom: 16,
    },
    containerUnderBreakpoint: {
        marginLeft: -8,
        marginRight: -8,
    },
    buttonContainer: {
        flex: 1,
        flexDirection: 'row',
        backgroundColor: colors.Grey100,
        borderTopWidth: 1,
        borderStyle: 'solid',
        borderTopColor: colors.Gray300,
        paddingVertical: 8,
        paddingHorizontal: 8,
    },
    buttonSection: {
        flexDirection: 'row',
        flexGrow: 1,
    },
    buttonSectionRight: {
        justifyContent: 'flex-end',
    },
    inputContainer: {
        paddingHorizontal: 16,
        overflow: 'hidden',
        flexDirection: 'row',
    },
    inputContainerEdit: {
        paddingTop: 8,
    },
    icon: {
        marginLeft: 7,
        marginTop: 7,
    },
    iconMobile: {
        marginLeft: -1,
    },
    textInputContainer: {
        borderTopLeftRadius: 4,
        borderTopRightRadius: 4,
        minHeight: 60,
        marginTop: 2,
        marginBottom: 8,
        marginLeft: 20,
    },
})
