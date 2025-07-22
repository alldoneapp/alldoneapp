import React, { useEffect, useRef } from 'react'
import { StyleSheet, View } from 'react-native'

import styles, { colors } from '../../../styles/global'
import CustomTextInput3 from '../../../Feeds/CommentsTextInput/CustomTextInput3'
import { CREATE_TASK_MODAL_THEME } from '../../../Feeds/CommentsTextInput/textInputHelper'

export default function InputArea({
    projectId,
    task,
    mentions,
    setMentions,
    onChangeInputText,
    enterKeyAction,
    setMentionsModalActive,
}) {
    const inputTask = useRef(null)

    const getInitialText = () => {
        const { extendedName, name } = task
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
            inputTask?.current?.focus()
        }, 1000)
    }, [])

    return (
        <View style={localStyles.inputContainer}>
            <View style={{ marginBottom: 8, minHeight: 38 }}>
                <CustomTextInput3
                    ref={inputTask}
                    placeholder={'Type to add task'}
                    placeholderTextColor={colors.Text03}
                    onChangeText={onChangeInputText}
                    multiline={true}
                    externalTextStyle={localStyles.textInputText}
                    caretColor="white"
                    autoFocus={true}
                    externalAlignment={{ paddingLeft: 0, paddingRight: 0 }}
                    containerStyle={{ marginRight: 20 }}
                    updateMentions={setMentions}
                    setMentionsModalActive={setMentionsModalActive}
                    initialTextExtended={getInitialText()}
                    initialMentions={mentions}
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
