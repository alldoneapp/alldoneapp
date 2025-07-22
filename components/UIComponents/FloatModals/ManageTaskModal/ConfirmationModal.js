import React, { Component } from 'react'
import { StyleSheet, Text, View, Dimensions } from 'react-native'

import styles, { colors, hexColorToRGBa } from '../../../styles/global'
import Button from '../../../UIControls/Button'
import { DELETE_TASK_CONFIRMATION_MODAL_ID, storeModal, removeModal } from '../../../ModalsManager/modalsManager'
import { translate } from '../../../../i18n/TranslationService'

class ConfirmationModal extends Component {
    constructor(props) {
        super(props)
        this.state = {}
    }

    componentDidMount() {
        document.addEventListener('keydown', this.onKeyDown)
        storeModal(DELETE_TASK_CONFIRMATION_MODAL_ID)
    }

    componentWillUnmount() {
        document.removeEventListener('keydown', this.onKeyDown)
        removeModal(DELETE_TASK_CONFIRMATION_MODAL_ID)
    }

    onKeyDown = event => {
        const { key } = event
        const { closeModal, deleteTask } = this.props
        if (key === 'Escape') {
            closeModal()
        } else if (key === 'Enter') {
            deleteTask()
        }
    }

    getDimentions = () => {
        const { height, width } = Dimensions.get('window')
        return { height, width }
    }

    render() {
        const { closeModal, deleteTask } = this.props
        const title = 'Be careful with this action'
        const description = 'Do you really want to perform this action?'
        return (
            <View style={[localStyles.container, this.getDimentions()]}>
                <View style={localStyles.popup}>
                    <View>
                        <Text style={localStyles.title}>{translate(title)}</Text>
                        <Text style={localStyles.description}>{translate(description)}</Text>
                    </View>
                    <View style={localStyles.buttonsContainer}>
                        <Button
                            title={translate('Cancel')}
                            type={'secondary'}
                            onPress={closeModal}
                            buttonStyle={localStyles.cancelButton}
                        />
                        <Button title={translate('Proceed')} type={'danger'} onPress={deleteTask} />
                    </View>
                </View>
            </View>
        )
    }
}

const localStyles = StyleSheet.create({
    container: {
        backgroundColor: hexColorToRGBa(colors.Text03, 0.24),
        justifyContent: 'center',
        alignItems: 'center',
    },
    popup: {
        backgroundColor: colors.Secondary400,
        padding: 16,
        shadowColor: 'rgba(0,0,0,0.04)',
        shadowOffset: { width: 0, height: 16 },
        shadowOpacity: 1,
        shadowRadius: 24,
        borderRadius: 4,
        alignItems: 'center',
    },
    title: {
        ...styles.title7,
        color: '#ffffff',
    },
    description: {
        ...styles.body2,
        color: colors.Text03,
    },
    buttonsContainer: {
        flexDirection: 'row',
        flex: 0,
        marginTop: 20,
    },
    cancelButton: {
        marginRight: 16,
    },
})

export default ConfirmationModal
