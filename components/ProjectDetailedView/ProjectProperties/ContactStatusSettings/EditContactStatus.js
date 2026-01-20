import React, { Component } from 'react'
import { Keyboard, StyleSheet, View } from 'react-native'
import Popover from 'react-tiny-popover'

import Button from '../../../UIControls/Button'
import Icon from '../../../Icon'
import store from '../../../../redux/store'
import { hideFloatPopup, showFloatPopup } from '../../../../redux/actions'
import styles, { colors } from '../../../styles/global'
import { translate } from '../../../../i18n/TranslationService'
import CustomTextInput3 from '../../../Feeds/CommentsTextInput/CustomTextInput3'
import ColorPickerModal from '../../../UIComponents/FloatModals/ColorPickerModal'
import { PROJECT_COLOR_BLUE } from '../../../../Themes/Modern/ProjectColors'
import {
    addContactStatus,
    updateContactStatus,
    deleteContactStatus,
} from '../../../../utils/backends/Projects/contactStatusFirestore'
import { TouchableOpacity } from 'react-native-gesture-handler'

class EditContactStatus extends Component {
    constructor(props) {
        super(props)
        const storeState = store.getState()

        this.state = {
            mounted: false,
            name: this.props.status ? this.props.status.name : '',
            color: this.props.status ? this.props.status.color : PROJECT_COLOR_BLUE,
            smallScreen: storeState.smallScreen,
            isMiddleScreen: storeState.isMiddleScreen,
            showFloatPopup: storeState.showFloatPopup,
            colorPickerOpen: false,
            unsubscribe: store.subscribe(this.updateState),
        }

        this.textInput = React.createRef()
    }

    componentDidMount() {
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
            smallScreen: storeState.smallScreen,
            isMiddleScreen: storeState.isMiddleScreen,
            showFloatPopup: storeState.showFloatPopup,
        })

        if (storeState.showGlobalSearchPopup) {
            const { onCancelAction } = this.props
            onCancelAction()
        }
    }

    enterKeyAction = () => {
        const { onCancelAction, formType, status } = this.props
        const { name, color, showFloatPopup } = this.state
        const validNew = formType === 'new' && name.length > 0
        const validEdit = formType === 'edit' && (name !== status.name || color !== status.color)

        if (showFloatPopup <= 0 && (validNew || validEdit)) {
            this.saveStatus()
            Keyboard.dismiss()
        }
    }

    onInputKeyPress = ({ key }) => {
        if (key === 'Enter') {
            this.enterKeyAction()
        } else if (key === 'Escape') {
            this.props.onCancelAction()
        }
    }

    onChangeInputText = text => {
        this.setState({ name: text })
    }

    saveStatus = () => {
        const { projectId, status, onCancelAction, formType } = this.props
        const { name, color } = this.state

        if (formType === 'new' && name.length > 0) {
            addContactStatus(projectId, name, color)
            onCancelAction()
        } else if (formType === 'edit') {
            if (name.length === 0) {
                this.deleteStatus()
            } else {
                updateContactStatus(projectId, status.id, name, color)
                onCancelAction()
            }
        }
        Keyboard.dismiss()
    }

    deleteStatus = () => {
        const { projectId, status, onCancelAction } = this.props
        deleteContactStatus(projectId, status.id)
        onCancelAction()
    }

    showColorPicker = () => {
        this.setState({ colorPickerOpen: true })
        store.dispatch(showFloatPopup())
    }

    hideColorPicker = () => {
        setTimeout(() => {
            this.setState({ colorPickerOpen: false })
            store.dispatch(hideFloatPopup())
        })
    }

    setColor = color => {
        this.setState({ color })
        this.hideColorPicker()
    }

    render() {
        const { status, onCancelAction, formType, style } = this.props
        const { mounted, name, color, smallScreen, isMiddleScreen, colorPickerOpen } = this.state
        const buttonItemStyle = { marginRight: smallScreen ? 8 : 4 }
        const disabled1 = formType === 'new' && name.length === 0
        const disabled2 = formType === 'edit' && name === status.name && color === status.color

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
                        <View style={[localStyles.colorDotContainer, { marginLeft: isMiddleScreen ? 14 : 24 }]}>
                            <View style={[localStyles.colorDot, { backgroundColor: color }]} />
                        </View>
                    )}
                    <CustomTextInput3
                        ref={this.textInput}
                        initialTextExtended={status !== undefined ? status.name : ''}
                        returnKeyType={'done'}
                        placeholder={translate('Type status name')}
                        containerStyle={[
                            localStyles.input,
                            formType === 'edit' ? localStyles.inputEdit : null,
                            isMiddleScreen ? localStyles.inputUnderBreakpoint : undefined,
                            isMiddleScreen && formType === 'edit' ? localStyles.inputEditUnderBreakpoint : null,
                        ]}
                        autoFocus={true}
                        multiline={false}
                        onChangeText={this.onChangeInputText}
                        placeholderTextColor={colors.Text03}
                        disabledTags={true}
                        selection={mounted ? undefined : { start: name.length, end: name.length }}
                        forceTriggerEnterActionForBreakLines={this.enterKeyAction}
                    />
                </View>
                <View style={localStyles.buttonContainer}>
                    <View style={[localStyles.buttonSection]}>
                        <View style={[localStyles.buttonSection, isMiddleScreen ? undefined : { marginRight: 32 }]}>
                            <Popover
                                content={
                                    <ColorPickerModal
                                        color={color}
                                        selectColor={this.setColor}
                                        closePopover={this.hideColorPicker}
                                        inSidebar={true}
                                    />
                                }
                                onClickOutside={this.hideColorPicker}
                                isOpen={colorPickerOpen}
                                position={['bottom', 'top', 'left', 'right']}
                                padding={4}
                                align={'start'}
                            >
                                <TouchableOpacity
                                    style={localStyles.colorButton}
                                    onPress={this.showColorPicker}
                                    accessible={false}
                                >
                                    <View style={[localStyles.colorButtonDot, { backgroundColor: color }]} />
                                    <Icon name="chevron-down" size={16} color={colors.Text03} />
                                </TouchableOpacity>
                            </Popover>

                            {formType === 'edit' && (
                                <Button
                                    type={'ghost'}
                                    icon={'trash-2'}
                                    buttonStyle={buttonItemStyle}
                                    noBorder={smallScreen}
                                    onPress={this.deleteStatus}
                                    accessible={false}
                                />
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
                                              ? 'Add status'
                                              : name.length === 0
                                              ? 'Delete status'
                                              : 'Save status'
                                      )
                            }
                            type={formType === 'edit' && name === '' ? 'danger' : 'primary'}
                            icon={
                                smallScreen
                                    ? formType === 'edit' && name === ''
                                        ? 'trash-2'
                                        : formType === 'new'
                                        ? 'plus'
                                        : 'save'
                                    : null
                            }
                            onPress={this.saveStatus}
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
export default EditContactStatus

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
        alignItems: 'center',
    },
    buttonSectionRight: {
        justifyContent: 'flex-end',
    },
    inputContainer: {
        minHeight: 56,
        flexDirection: 'row',
        alignItems: 'center',
    },
    icon: {
        position: 'absolute',
        padding: 0,
        margin: 0,
        left: 15,
        top: 16,
    },
    iconNew: {
        top: 16,
    },
    input: {
        ...styles.body1,
        paddingTop: 6,
        paddingBottom: 6,
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
    colorDotContainer: {
        width: 24,
        height: 24,
        alignItems: 'center',
        justifyContent: 'center',
    },
    colorDot: {
        width: 16,
        height: 16,
        borderRadius: 8,
    },
    colorButton: {
        flexDirection: 'row',
        alignItems: 'center',
        height: 32,
        paddingHorizontal: 8,
        borderRadius: 4,
        borderWidth: 1,
        borderColor: colors.Grey300,
        marginRight: 8,
    },
    colorButtonDot: {
        width: 16,
        height: 16,
        borderRadius: 8,
        marginRight: 4,
    },
})
