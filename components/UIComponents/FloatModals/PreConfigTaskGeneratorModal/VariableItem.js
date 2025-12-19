import React, { useEffect, useRef } from 'react'
import { StyleSheet, Text, View } from 'react-native'

import styles, { colors } from '../../../styles/global'
import CustomTextInput3 from '../../../Feeds/CommentsTextInput/CustomTextInput3'
import { COMMENT_MODAL_THEME } from '../../../Feeds/CommentsTextInput/textInputHelper'
import { translate } from '../../../../i18n/TranslationService'

export default function VariableItem({ setInputRefs, setValue, name, value, projectId }) {
    useEffect(() => {
        document.activeElement.blur()
    }, [])

    const setRef = ref => {
        setInputRefs(ref, name)
    }

    const mentionItemRef = useRef(null)

    const onMentionSelected = item => {
        mentionItemRef.current = item
    }

    return (
        <View style={localStyles.section}>
            <Text style={localStyles.text}>{`$${name}`}</Text>
            <CustomTextInput3
                ref={setRef}
                containerStyle={localStyles.input}
                initialTextExtended={value && value.raw ? value.raw : value}
                placeholder={translate('Type the variable value')}
                placeholderTextColor={colors.Text03}
                multiline={false}
                numberOfLines={1}
                onChangeText={text => {
                    if (mentionItemRef.current) {
                        setValue(name, { raw: text, display: mentionItemRef.current.displayName })
                        mentionItemRef.current = null
                    } else {
                        setValue(name, text)
                    }
                }}
                onMentionSelected={onMentionSelected}
                disabledTags={false}
                projectId={projectId}
                singleLine={false}
                styleTheme={COMMENT_MODAL_THEME}
                disabledTabKey={true}
            />
        </View>
    )
}

const localStyles = StyleSheet.create({
    section: {
        flex: 1,
        marginBottom: 12,
    },
    text: {
        ...styles.body2,
        color: colors.Text03,
        marginBottom: 4,
    },
    input: {
        ...styles.body1,
        color: colors.Grey200,
        paddingVertical: 3,
        paddingHorizontal: 16,
        borderWidth: 1,
        borderColor: colors.Grey100,
        backgroundColor: colors.Text01,
        minHeight: 42,
        maxHeight: 42,
    },
})
