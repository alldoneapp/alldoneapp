import React, { useState, useRef, useEffect } from 'react'
import { StyleSheet, View } from 'react-native'

import { colors } from '../../../styles/global'
import { applyPopoverWidth, MODAL_MAX_HEIGHT_GAP } from '../../../../utils/HelperFunctions'
import useWindowSize from '../../../../utils/useWindowSize'
import CustomScrollView from '../../../UIControls/CustomScrollView'
import { translate } from '../../../../i18n/TranslationService'
import ModalHeader from '../ModalHeader'
import NameArea from './NameArea'
import ButtonsArea from './ButtonsArea'

export default function VariableModal({ disabled, closeModal, addVariable, updateVariable, variableIndex, variables }) {
    const variable = variables[variableIndex]

    const [name, setName] = useState(variable ? variable.name : '')

    const nameInputRef = useRef()

    const [width, height] = useWindowSize()

    const adding = variableIndex === null
    const disableButton = !name.trim()

    const addData = () => {
        const newVariable = { name: name.replace(/\s/g, '') }
        addVariable(newVariable)
        closeModal()
    }

    const updateData = () => {
        const updatedVariable = { name: name.replace(/\s/g, '') }
        updateVariable(updatedVariable, variableIndex)
        closeModal()
    }

    const onPressKey = event => {
        if (event.key === 'Enter' && !disableButton && !event.shiftKey) {
            event.preventDefault()
            event.stopPropagation()
            adding ? addData() : updateData()
        }
    }

    useEffect(() => {
        setTimeout(() => nameInputRef.current.focus(), 1)
    }, [])

    useEffect(() => {
        document.addEventListener('keydown', onPressKey)
        return () => {
            document.removeEventListener('keydown', onPressKey)
        }
    })

    return (
        <View style={[localStyles.container, applyPopoverWidth(), { maxHeight: height - MODAL_MAX_HEIGHT_GAP }]}>
            <CustomScrollView style={localStyles.scroll} showsVerticalScrollIndicator={false}>
                <ModalHeader
                    title={translate(adding ? 'Add new variable' : 'Update variable')}
                    description={translate(
                        adding ? 'Enter the data to add the variable' : 'Change the data to update the variable'
                    )}
                    closeModal={closeModal}
                />
                <NameArea
                    nameInputRef={nameInputRef}
                    name={name}
                    setName={setName}
                    variables={variables}
                    initialName={variable ? variable.name : ''}
                    disabled={disabled}
                />
                <ButtonsArea
                    adding={adding}
                    addData={addData}
                    updateData={updateData}
                    disabled={disableButton || disabled}
                    closeModal={closeModal}
                />
            </CustomScrollView>
        </View>
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
})
