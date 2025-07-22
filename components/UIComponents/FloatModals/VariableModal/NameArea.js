import React, { useEffect } from 'react'
import { StyleSheet, Text, View } from 'react-native'

import styles, { colors } from '../../../styles/global'
import CustomTextInput3 from '../../../Feeds/CommentsTextInput/CustomTextInput3'
import { COMMENT_MODAL_THEME } from '../../../Feeds/CommentsTextInput/textInputHelper'
import { translate } from '../../../../i18n/TranslationService'
import Icon from '../../../Icon'

export default function NameArea({ disabled, nameInputRef, name, setName, variables, initialName }) {
    useEffect(() => {
        setTimeout(() => nameInputRef.current.focus(), 1)
    }, [])

    const parsedName = name.replace(/\s/g, '').toUpperCase()
    const inUse =
        initialName.replace(/\s/g, '').toUpperCase() !== parsedName &&
        variables.some(variable => variable.name.replace(/\s/g, '').toUpperCase() === parsedName)

    let warning = ''
    if (inUse) warning = 'The name is already in use'
    else if (/\s/g.test(name)) warning = 'Spaces in the name will be removed'

    return (
        <View style={localStyles.section}>
            <Text style={localStyles.text}>{translate('Name')}</Text>
            <CustomTextInput3
                ref={nameInputRef}
                containerStyle={localStyles.input}
                initialTextExtended={name}
                placeholder={translate('Type the variable name')}
                placeholderTextColor={colors.Text03}
                multiline={false}
                numberOfLines={1}
                onChangeText={setName}
                disabledTags={true}
                singleLine={true}
                styleTheme={COMMENT_MODAL_THEME}
                disabledTabKey={true}
                disabledEdition={disabled}
                autoFocus={true}
            />
            {!!warning && (
                <View style={localStyles.warningContainer}>
                    <Icon name={'info'} size={18} color={colors.UtilityRed150} />
                    <Text style={localStyles.warning}>{translate(warning)}</Text>
                </View>
            )}
        </View>
    )
}

const localStyles = StyleSheet.create({
    section: {
        flex: 1,
    },
    text: {
        ...styles.subtitle2,
        color: colors.Text02,
        marginBottom: 4,
    },
    input: {
        ...styles.body1,
        color: '#ffffff',
        paddingVertical: 3,
        paddingHorizontal: 16,
        borderWidth: 1,
        borderColor: colors.Grey400,
        borderRadius: 4,
        minHeight: 42,
        maxHeight: 42,
    },
    warningContainer: {
        flexDirection: 'row',
        marginTop: 4,
        alignItems: 'center',
    },
    warning: { ...styles.subtitle2, color: colors.UtilityRed150, marginLeft: 4 },
})
