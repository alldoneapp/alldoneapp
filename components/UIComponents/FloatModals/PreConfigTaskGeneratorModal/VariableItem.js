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
        // If we have a value and the ref is ready, we might need to update it if it wasn't initial.
        // However, CustomTextInput3 handles initialTextExtended on mount.
        // We need to handle updates if the value changes later (e.g. pre-fill).
        if (ref && value && value.raw && ref.clearAndSetContent) {
            // Check if content is already set to avoid loops or overwrites?
            // Actually, for pre-fill, we want to force it.
            // But we need to be careful not to overwrite user input if they type something else.
            // Since values state is controlled, we rely on value.raw.
        }
    }

    // We use a separate ref to track if we have already initialized the value to avoid overwriting user typing
    const initializedRef = useRef(false)

    useEffect(() => {
        if (value && value.raw && !initializedRef.current && inputRefs.current[name]?.clearAndSetContent) {
            inputRefs.current[name].clearAndSetContent(value.raw)
            initializedRef.current = true
        }
    }, [value, inputRefs.current[name]])

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
