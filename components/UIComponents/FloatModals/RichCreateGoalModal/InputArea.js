import React, { useEffect, useRef } from 'react'
import { StyleSheet, View } from 'react-native'

import styles from '../../../styles/global'
import CustomTextInput3 from '../../../Feeds/CommentsTextInput/CustomTextInput3'
import { CREATE_TASK_MODAL_THEME } from '../../../Feeds/CommentsTextInput/textInputHelper'

export default function InputArea({ projectId, goal, onChangeInputText, enterKeyAction, setMentionsModalActive }) {
    const inputRef = useRef(null)

    const getInitialText = () => {
        const { extendedName, name } = goal
        if (name && extendedName) {
            const mentionRegExp = /@\S*$/
            const parts = extendedName.split(' ')
            const mentionMatch = parts[parts.length - 1].match(mentionRegExp)
            return `${extendedName}${mentionMatch ? '  ' : ' '}`
        }
        return ''
    }

    useEffect(() => {
        setTimeout(() => {
            inputRef?.current?.focus()
        }, 1000)
    }, [])

    return (
        <View style={localStyles.inputContainer}>
            <View style={{ marginBottom: 8, minHeight: 38 }}>
                <CustomTextInput3
                    ref={inputRef}
                    placeholder={'Type to add goal'}
                    onChangeText={onChangeInputText}
                    autoFocus={true}
                    containerStyle={{ marginRight: 20 }}
                    setMentionsModalActive={setMentionsModalActive}
                    initialTextExtended={getInitialText()}
                    projectId={projectId}
                    styleTheme={CREATE_TASK_MODAL_THEME}
                    forceTriggerEnterActionForBreakLines={enterKeyAction}
                />
            </View>
        </View>
    )
}

const localStyles = StyleSheet.create({
    inputContainer: {
        paddingTop: 2,
        paddingHorizontal: 16,
    },
    textInputText: {
        ...styles.body1,
        color: '#ffffff',
    },
})
