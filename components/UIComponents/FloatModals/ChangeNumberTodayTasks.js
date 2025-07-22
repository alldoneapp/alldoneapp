import React, { Component } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import styles, { colors } from '../../styles/global'
import { TouchableOpacity } from 'react-native-gesture-handler'
import PropTypes from 'prop-types'
import Icon from '../../Icon'
import Button from '../../UIControls/Button'
import Shortcut, { SHORTCUT_LIGHT } from '../../UIControls/Shortcut'
import Hotkeys from 'react-hot-keys'
import store from '../../../redux/store'
import CustomTextInput3 from '../../Feeds/CommentsTextInput/CustomTextInput3'
import { COMMENT_MODAL_THEME } from '../../Feeds/CommentsTextInput/textInputHelper'
import { applyPopoverWidth, MODAL_MAX_HEIGHT_GAP } from '../../../utils/HelperFunctions'
import { withWindowSizeHook } from '../../../utils/useWindowSize'
import CustomScrollView from '../../UIControls/CustomScrollView'
import { translate } from '../../../i18n/TranslationService'

class ChangeNumberTodayTasks extends Component {
    constructor(props) {
        super(props)

        this.state = {
            currentValue: this.props.allowZeroValue
                ? this.props.currentValue >= 0
                    ? this.props.currentValue
                    : ''
                : this.props.currentValue > 0
                ? this.props.currentValue
                : '',
        }

        this.inputText = React.createRef()
    }

    componentDidMount() {
        document.addEventListener('keydown', this.onPressEnter)
        setTimeout(() => this.inputText?.current?.focus(), 1)
    }

    componentWillUnmount() {
        document.removeEventListener('keydown', this.onPressEnter)
    }

    onPressEnter = event => {
        if (event.key === 'Enter') {
            this.onPressSaveButton()
        } else if (event.key === 'Escape') {
            this.props.closePopover()
        }
    }

    setUnlimited = event => {
        if (event) {
            event.preventDefault()
            event.stopPropagation()
        }
        const { onSaveData, closePopover } = this.props
        onSaveData(0)
        closePopover()
    }

    onPressSaveButton = () => {
        const { currentValue } = this.state
        const { onSaveData, closePopover, allowZeroValue } = this.props

        if (!isNaN(currentValue) && (allowZeroValue ? currentValue >= 0 : currentValue > 0)) {
            onSaveData(currentValue)
            closePopover()
        }
    }

    render() {
        const { currentValue } = this.state
        const {
            windowSize,
            customTitle,
            customSubtitle,
            hideUnlimitedButton,
            allowZeroValue,
            customPropertyName,
        } = this.props
        const { mobile } = store.getState()

        const title = customTitle || translate('Tasks visible in today group')
        const subtitle = customSubtitle || translate('Tasks visible in today subtitle')

        return (
            <View
                style={[
                    localStyles.container,
                    applyPopoverWidth(),
                    { maxHeight: windowSize[1] - MODAL_MAX_HEIGHT_GAP },
                ]}
            >
                <CustomScrollView showsVerticalScrollIndicator={false}>
                    <View style={localStyles.parentSection}>
                        <View style={{ marginBottom: 20 }}>
                            <Text style={[styles.title7, { color: '#ffffff' }]}>{title}</Text>
                            <Text style={[styles.body2, { color: colors.Text03 }]}>{subtitle}</Text>
                        </View>

                        {!hideUnlimitedButton && (
                            <Hotkeys
                                keyName={'alt+1'}
                                onKeyDown={(sht, event) => this.setUnlimited(event)}
                                filter={e => true}
                            >
                                <TouchableOpacity style={localStyles.dateSectionItem} onPress={this.setUnlimited}>
                                    <View style={localStyles.dateSectionItem}>
                                        <View style={localStyles.sectionItemText}>
                                            <Text style={[styles.subtitle1, { color: '#ffffff' }]}>
                                                {translate('Unlimited')}
                                            </Text>
                                        </View>
                                        <View style={localStyles.sectionItemCheck}>
                                            {!mobile && <Shortcut text={'Alt + 1'} theme={SHORTCUT_LIGHT} />}
                                        </View>
                                    </View>
                                </TouchableOpacity>
                            </Hotkeys>
                        )}
                    </View>

                    {!hideUnlimitedButton && <View style={localStyles.line} />}

                    <View style={localStyles.parentSection}>
                        <View style={localStyles.section}>
                            <Text style={localStyles.roleLabel}>{translate(customPropertyName || 'Custom')}</Text>
                            <CustomTextInput3
                                ref={this.inputText}
                                containerStyle={localStyles.roleInput}
                                initialTextExtended={
                                    !allowZeroValue && currentValue == 0 ? '' : currentValue.toString()
                                }
                                placeholder={translate('Type a number')}
                                placeholderTextColor={colors.Text03}
                                multiline={false}
                                numberOfLines={1}
                                onChangeText={text => {
                                    this.setState({ currentValue: parseInt(text) })
                                }}
                                disabledTags={true}
                                singleLine={true}
                                keyboardType={'numeric'}
                                styleTheme={COMMENT_MODAL_THEME}
                                autoFocus={true}
                            />
                        </View>
                        <View style={localStyles.buttonContainer}>
                            <Button
                                type={'primary'}
                                title={translate('Save')}
                                onPress={this.onPressSaveButton}
                                disabled={
                                    isNaN(currentValue) || (allowZeroValue ? currentValue < 0 : currentValue <= 0)
                                }
                            />
                        </View>
                    </View>
                </CustomScrollView>
                <View style={localStyles.closeContainer}>
                    <TouchableOpacity style={localStyles.closeButton} onPress={this.props.closePopover}>
                        <Icon name={'x'} size={24} color={colors.Text03} />
                    </TouchableOpacity>
                </View>
            </View>
        )
    }
}

const localStyles = StyleSheet.create({
    container: {
        backgroundColor: colors.Secondary400,
        paddingTop: 16,
        paddingBottom: 16,
        borderRadius: 4,
        width: 305,
        shadowColor: 'rgba(78, 93, 120, 0.56)',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 1,
        shadowRadius: 16,
        elevation: 3,
    },
    line: {
        height: 1,
        borderTopWidth: 1,
        borderTopColor: '#ffffff',
        opacity: 0.2,
        marginTop: 8,
        marginBottom: 16,
    },
    parentSection: {
        flex: 1,
        paddingHorizontal: 16,
    },
    section: {
        flex: 1,
    },
    roleLabel: {
        ...styles.subtitle2,
        color: colors.Text02,
        marginBottom: 4,
    },
    roleInput: {
        ...styles.body1,
        color: '#ffffff',
        paddingVertical: 3,
        height: 42,
        paddingHorizontal: 16,
        borderWidth: 1,
        borderColor: colors.Grey400,
        borderRadius: 4,
    },
    buttonContainer: {
        flexDirection: 'row',
        justifyContent: 'center',
        marginTop: 16,
    },
    closeContainer: {
        position: 'absolute',
        top: 8,
        right: 8,
    },
    closeButton: {
        alignItems: 'center',
        justifyContent: 'center',
    },
    dateSectionItem: {
        flex: 1,
        height: 40,
        flexDirection: 'row',
        alignItems: 'center',
        overflow: 'visible',
    },
    sectionItemText: {
        flexDirection: 'row',
        flexGrow: 1,
    },
    sectionItemCheck: {
        justifyContent: 'flex-end',
    },
})

ChangeNumberTodayTasks.propTypes = {
    currentValue: PropTypes.string,
    closePopover: PropTypes.func,
    onSaveData: PropTypes.func,
}

export default withWindowSizeHook(ChangeNumberTodayTasks)
