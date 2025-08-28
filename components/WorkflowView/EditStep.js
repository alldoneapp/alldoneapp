import React, { Component } from 'react'
import { Keyboard, StyleSheet, Text, View } from 'react-native'
import Hotkeys from 'react-hot-keys'

import Button from '../UIControls/Button'
import Icon from '../Icon'
import store from '../../redux/store'
import { setWorkflowStep, showConfirmPopup, showFloatPopup } from '../../redux/actions'
import styles, { colors } from '../styles/global'
import SendTo from './SendTo'
import { CONFIRM_POPUP_TRIGGER_DELETE_WORKFLOW_STEP } from '../UIComponents/ConfirmPopup'
import { execShortcutFn } from '../../utils/HelperFunctions'
import CustomTextInput3 from '../Feeds/CommentsTextInput/CustomTextInput3'
import { FEED_USER_WORKFLOW_CHANGED } from '../Feeds/Utils/FeedsConstants'
import { translate } from '../../i18n/TranslationService'
import { createWorkflowStepFeed, createWorkflowStepFeedChangeTitle } from '../../utils/backends/Users/userUpdates'
import { addUserWorkflowStep, modifyUserWorkflowStep } from '../../utils/backends/Users/usersFirestore'

/*user,
step,
steps,
stepNumber,
projectIndex,
startUpdatingStepIndicator,
onDoneUpdatingStep,
onCancelAction,
formType,
style,*/

class EditStep extends Component {
    constructor(props) {
        super(props)
        const storeState = store.getState()

        this.state = {
            mounted: false,
            description: this.props.step ? this.props.step.description : '',
            loggedUser: storeState.loggedUser,
            smallScreen: storeState.smallScreen,
            isMiddleScreen: storeState.isMiddleScreen,
            showFloatPopup: storeState.showFloatPopup,
            loggedUserProjects: storeState.loggedUserProjects,
            workflowStep: storeState.workflowStep,
            unsubscribe: store.subscribe(this.updateState),
        }

        this.delBtnRef = React.createRef()
        this.textInput = React.createRef()
    }

    componentDidMount() {
        const { step } = this.props
        const { loggedUser } = this.state
        let defaultStep = {}

        if (step) {
            defaultStep = step
        } else {
            defaultStep = {
                reviewerUid: loggedUser.uid,
            }
        }
        store.dispatch(setWorkflowStep(defaultStep))
        document.addEventListener('keydown', this.onInputKeyPress)
        this.setState({ mounted: true })
    }

    componentWillUnmount() {
        document.removeEventListener('keydown', this.onInputKeyPress)
        this.state.unsubscribe()
    }

    updateState = () => {
        const storeState = store.getState()

        this.setState({
            loggedUser: storeState.loggedUser,
            smallScreen: storeState.smallScreen,
            isMiddleScreen: storeState.isMiddleScreen,
            showFloatPopup: storeState.showFloatPopup,
            loggedUserProjects: storeState.loggedUserProjects,
            workflowStep: storeState.workflowStep,
        })

        if (storeState.showGlobalSearchPopup) {
            const { onCancelAction } = this.props
            onCancelAction()
        }
    }

    enterKeyAction = () => {
        const { onCancelAction, formType, step } = this.props
        const { workflowStep, description, showFloatPopup } = this.state
        const validNew = formType === 'new' && description.length > 0
        const validEdit =
            formType === 'edit' && (workflowStep.reviewerUid !== step.reviewerUid || description !== step.description)

        if (showFloatPopup <= 0 && (validNew || validEdit)) {
            this.modifyWorkflowStep()
            // onCancelAction()
            Keyboard.dismiss()
        }
    }

    onInputKeyPress = ({ key }) => {
        if (key === 'Enter') {
            this.enterKeyAction()
        }
    }

    onChangeInputText = text => {
        this.setState({ description: text })
    }

    modifyWorkflowStep = () => {
        const {
            user,
            step,
            projectIndex,
            startUpdatingStepIndicator,
            onDoneUpdatingStep,
            onCancelAction,
            formType,
        } = this.props
        const { description, loggedUser, loggedUserProjects, workflowStep } = this.state
        const project = loggedUserProjects[projectIndex]

        if (formType === 'new' && description.length > 0) {
            const stepCopy = {
                ...workflowStep,
                description,
                addedById: loggedUser.uid,
                date: Date.now(),
            }
            addUserWorkflowStep(project.id, user.uid, stepCopy)
            onCancelAction()
        } else if (formType === 'edit') {
            if (description.length === 0) {
                this.deleteStep()
            } else {
                if (startUpdatingStepIndicator) startUpdatingStepIndicator()
                const stepCopy =
                    workflowStep.reviewerUid !== undefined
                        ? {
                              ...workflowStep,
                              description,
                              addedById: loggedUser.uid,
                              date: Date.now(),
                          }
                        : {
                              reviewerUid: step.reviewerUid,
                              description: description,
                              addedById: loggedUser.uid,
                              date: Date.now(),
                          }
                modifyUserWorkflowStep(project.id, user.uid, step.id, stepCopy, step.reviewerUid).then(
                    onDoneUpdatingStep
                )
                if (stepCopy.reviewerUid !== step.reviewerUid) {
                    createWorkflowStepFeed(
                        project.id,
                        step.reviewerUid,
                        user.uid,
                        step.description,
                        FEED_USER_WORKFLOW_CHANGED,
                        stepCopy.reviewerUid
                    )
                }
                if (stepCopy.description !== step.description) {
                    createWorkflowStepFeedChangeTitle(
                        project.id,
                        step.reviewerUid,
                        user.uid,
                        step.description,
                        stepCopy.description
                    )
                }
                onCancelAction()
            }
        }
        Keyboard.dismiss()
    }

    deleteStep = () => {
        const { user, step, steps, projectIndex } = this.props
        store.dispatch([
            showFloatPopup(),
            showConfirmPopup({
                trigger: CONFIRM_POPUP_TRIGGER_DELETE_WORKFLOW_STEP,
                object: {
                    projectIndex: projectIndex,
                    userUid: user.uid,
                    stepId: step.id,
                    steps: steps,
                    reviewerUid: step.reviewerUid,
                },
            }),
        ])
    }

    focusInput = () => {
        this.textInput?.current?.focus()
    }

    render() {
        const { user, step, stepNumber, projectIndex, onCancelAction, formType, style } = this.props
        const { mounted, description, smallScreen, isMiddleScreen, workflowStep } = this.state
        const buttonItemStyle = { marginRight: smallScreen ? 8 : 4 }
        const disabled1 = formType === 'new' && description.length === 0
        const disabled2 =
            formType === 'edit' && workflowStep.reviewerUid === step.reviewerUid && description === step.description

        return (
            <View
                style={[
                    localStyles.container,
                    isMiddleScreen ? localStyles.containerUnderBreakpoint : undefined,
                    style,
                ]}
            >
                <View style={[localStyles.inputContainer]}>
                    <View style={[localStyles.icon, formType === 'new' ? localStyles.iconNew : undefined]}>
                        {formType === 'new' ? <Icon name={'plus-square'} size={24} color={colors.Primary100} /> : null}
                    </View>
                    {formType === 'edit' && (
                        <View style={[localStyles.numberContainer, { marginLeft: isMiddleScreen ? 14 : 24 }]}>
                            <Text style={[styles.subtitle1, { color: 'white' }]}>{stepNumber}</Text>
                        </View>
                    )}
                    <CustomTextInput3
                        ref={this.textInput}
                        initialTextExtended={step !== undefined ? step.description : ''}
                        returnKeyType={'done'}
                        placeholder={translate('Type to add new step')}
                        containerStyle={[
                            localStyles.input,
                            formType === 'edit' ? localStyles.inputEdit : null,
                            isMiddleScreen ? localStyles.inputUnderBreakpoint : undefined,
                            isMiddleScreen && formType === 'edit' ? localStyles.inputEditUnderBreakpoint : null,
                        ]}
                        autoFocus={true}
                        multiline={true}
                        numberOfLines={2}
                        // onKeyPress={this.onInputKeyPress}
                        onChangeText={this.onChangeInputText}
                        placeholderTextColor={colors.Text03}
                        disabledTags={true}
                        selection={mounted ? undefined : { start: description.length, end: description.length }}
                        forceTriggerEnterActionForBreakLines={this.enterKeyAction}
                    />
                </View>
                <View style={localStyles.buttonContainer}>
                    <View style={[localStyles.buttonSection]}>
                        <View style={[localStyles.buttonSection, isMiddleScreen ? undefined : { marginRight: 32 }]}>
                            <SendTo
                                defaultReviewer={workflowStep?.hasOwnProperty('reviewerUid') ? workflowStep : undefined}
                                currentUser={user}
                                projectIndex={projectIndex}
                                onChangeValue={this.focusInput}
                            />

                            {formType === 'edit' && (
                                <Hotkeys
                                    keyName={'alt+Del'}
                                    onKeyDown={(sht, event) =>
                                        execShortcutFn(this.delBtnRef.current, this.deleteStep, event)
                                    }
                                    filter={e => true}
                                >
                                    <Button
                                        ref={this.delBtnRef}
                                        type={'ghost'}
                                        icon={'trash-2'}
                                        buttonStyle={buttonItemStyle}
                                        noBorder={smallScreen}
                                        onPress={this.deleteStep}
                                        accessible={false}
                                        shortcutText={'Del'}
                                    />
                                </Hotkeys>
                            )}
                        </View>
                    </View>

                    <View style={[localStyles.buttonSection, localStyles.buttonSectionRight]}>
                        {smallScreen ? undefined : (
                            <Button
                                title={translate('Cancel')}
                                type={'secondary'}
                                buttonStyle={buttonItemStyle}
                                onPress={onCancelAction}
                                shortcutText={'Esc'}
                            />
                        )}

                        <Button
                            title={
                                smallScreen
                                    ? null
                                    : translate(
                                          formType === 'new'
                                              ? `Add Step`
                                              : description.length === 0
                                              ? 'Delete step'
                                              : 'Save step'
                                      )
                            }
                            type={formType === 'edit' && description === '' ? 'danger' : 'primary'}
                            icon={
                                smallScreen
                                    ? formType === 'edit' && description === ''
                                        ? 'trash-2'
                                        : formType === 'new'
                                        ? 'plus'
                                        : 'save'
                                    : null
                            }
                            onPress={this.modifyWorkflowStep}
                            disabled={disabled1 || disabled2}
                            accessible={false}
                            shortcutText={'Enter'}
                        />
                    </View>
                </View>
            </View>
        )
    }
}
export default EditStep

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
        paddingHorizontal: 9,
    },
    buttonSection: {
        flexDirection: 'row',
        flexGrow: 1,
    },
    buttonSectionRight: {
        justifyContent: 'flex-end',
    },
    inputContainer: {
        minHeight: 72,
        flexDirection: 'row',
    },
    icon: {
        position: 'absolute',
        padding: 0,
        margin: 0,
        left: 15,
        top: 11,
    },
    iconNew: {
        top: 11,
    },
    input: {
        ...styles.body1,
        paddingTop: 6,
        paddingBottom: 16,
        borderTopLeftRadius: 4,
        borderTopRightRadius: 4,
        paddingLeft: 63,
        paddingRight: 16,
    },
    inputEdit: {
        paddingLeft: 15,
    },
    inputUnderBreakpoint: {
        paddingLeft: 43,
        paddingRight: 8,
    },
    inputEditUnderBreakpoint: {
        paddingLeft: 5,
    },
    numberContainer: {
        width: 24,
        height: 24,
        backgroundColor: colors.UtilityBlue200,
        borderRadius: 2,
        marginTop: 12,
        alignItems: 'center',
        justifyContent: 'center',
    },
})
