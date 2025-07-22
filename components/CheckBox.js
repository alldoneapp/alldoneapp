import React, { useRef, useEffect } from 'react'
import { StyleSheet, View } from 'react-native'
import Icon from '../components/Icon'
import { colors } from './styles/global'

export default function CheckBox({ checked, isSubtask, dragMode, checkOnDrag, externalContainerStyle, checkBoxId }) {
    const checkBoxRef = useRef(null)

    useEffect(() => {
        if (checkBoxId) {
            checkBoxRef.current.setNativeProps({
                'check-box-id': checkBoxId,
            })
        }
    }, [])

    return (
        <View
            ref={checkBoxRef}
            style={[
                localStyles.unchecked,
                checked && !dragMode ? localStyles.checked : null,
                isSubtask ? localStyles.subtask : null,
                dragMode ? localStyles.dragMode : null,
                checkOnDrag && [localStyles.checked, { backgroundColor: colors.Primary100, borderWidth: 0 }],
                externalContainerStyle,
            ]}
        >
            {checked || checkOnDrag ? <Icon size={16} name="check" color="white" /> : null}
        </View>
    )
}

const localStyles = StyleSheet.create({
    unchecked: {
        height: 24,
        width: 24,
        borderRadius: 4,
        borderWidth: 1,
        borderColor: colors.Text03,
        backgroundColor: 'white',
    },
    dragMode: {
        borderRadius: 100,
    },
    checked: {
        backgroundColor: colors.Text03,
        justifyContent: 'center',
        alignItems: 'center',
    },
    subtask: {
        height: 20,
        width: 20,
    },
})
