import React, { Component } from 'react'
import { StyleSheet, Text, View, TextInput } from 'react-native'
import styles, { colors } from '../../styles/global'
import { TouchableOpacity } from 'react-native-gesture-handler'
import PropTypes from 'prop-types'
import Icon from '../../Icon'
import Button from '../../UIControls/Button'
import { applyPopoverWidth, MODAL_MAX_HEIGHT_GAP } from '../../../utils/HelperFunctions'
import CustomScrollView from '../../UIControls/CustomScrollView'
import { withWindowSizeHook } from '../../../utils/useWindowSize'
import { translate } from '../../../i18n/TranslationService'

class ChangeTextFieldModal extends Component {
    constructor(props) {
        super(props)

        this.state = {
            currentValue: this.props.currentValue || '',
        }

        this.inputText = React.createRef()
    }

    componentDidMount() {
        document.addEventListener('keydown', this.onPressEnter)
        setTimeout(() => this.inputText && this.inputText.current.focus(), 1)
    }

    componentWillUnmount() {
        document.removeEventListener('keydown', this.onPressEnter)
    }

    onPressEnter = event => {
        if (event.key === 'Enter') {
            this.onPressSaveButton()
        } else if (event.key === 'Escape') {
            event?.preventDefault()
            event?.stopPropagation()
            this.props.closePopover()
        }
    }

    onPressSaveButton = () => {
        const { currentValue } = this.state
        const { onSaveData, closePopover, validateFunction } = this.props

        if (validateFunction === undefined || validateFunction(currentValue.trim())) {
            onSaveData(currentValue.trim())
            closePopover()
        }
    }

    render() {
        const { currentValue } = this.state
        const { header, subheader, label, placeholder, validateFunction, windowSize } = this.props

        return (
            <View
                style={[
                    localStyles.container,
                    applyPopoverWidth(),
                    { maxHeight: windowSize[1] - MODAL_MAX_HEIGHT_GAP },
                ]}
            >
                <CustomScrollView style={localStyles.scroll} showsVerticalScrollIndicator={false}>
                    <View style={{ marginBottom: 20 }}>
                        <Text style={[styles.title7, { color: '#ffffff' }]}>{translate(header)}</Text>
                        {subheader !== undefined && (
                            <Text style={[styles.body2, { color: colors.Text03 }]}>{translate(subheader)}</Text>
                        )}
                    </View>
                    <View style={localStyles.section}>
                        {label !== undefined && <Text style={localStyles.roleLabel}>{translate(label)}</Text>}
                        <TextInput
                            ref={this.inputText}
                            style={localStyles.roleInput}
                            value={currentValue}
                            placeholder={placeholder}
                            placeholderTextColor={colors.Text03}
                            multiline={false}
                            numberOfLines={1}
                            onChangeText={text => {
                                this.setState({ currentValue: text })
                            }}
                        />
                    </View>
                    <View style={localStyles.buttonContainer}>
                        <Button
                            type={'primary'}
                            title={`${translate('Save')} ${translate(label)}`}
                            onPress={this.onPressSaveButton}
                            disabled={validateFunction !== undefined && !validateFunction(currentValue.trim())}
                        />
                    </View>
                    <View style={localStyles.closeContainer}>
                        <TouchableOpacity style={localStyles.closeButton} onPress={this.props.closePopover}>
                            <Icon name="x" size={24} color={colors.Text03} />
                        </TouchableOpacity>
                    </View>
                </CustomScrollView>
            </View>
        )
    }
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
        paddingVertical: 8,
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
        top: -4,
        right: -4,
    },
    closeButton: {
        alignItems: 'center',
        justifyContent: 'center',
    },
})

ChangeTextFieldModal.propTypes = {
    header: PropTypes.string.isRequired,
    subheader: PropTypes.string,
    label: PropTypes.string.isRequired,
    placeholder: PropTypes.string,
    currentValue: PropTypes.string,
    closePopover: PropTypes.func,
    onSaveData: PropTypes.func,
    validateFunction: PropTypes.func,
}

export default withWindowSizeHook(ChangeTextFieldModal)
