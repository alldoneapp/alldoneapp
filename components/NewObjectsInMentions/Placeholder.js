import React from 'react'
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import Icon from '../Icon'
import styles, { colors } from '../styles/global'
import {
    MENTION_MODAL_CONTACTS_TAB,
    MENTION_MODAL_NOTES_TAB,
    MENTION_MODAL_TASKS_TAB,
    MENTION_MODAL_TOPICS_TAB,
    MENTION_MODAL_GOALS_TAB,
} from '../Feeds/CommentsTextInput/textInputHelper'
import { translate } from '../../i18n/TranslationService'

export default function Placeholder({ activeTab = MENTION_MODAL_TASKS_TAB, onPress, hover }) {
    const getPlaceholderText = () => {
        switch (activeTab) {
            case MENTION_MODAL_TASKS_TAB:
                return translate('Create new task')
            case MENTION_MODAL_CONTACTS_TAB:
                return translate('Create new contact')
            case MENTION_MODAL_NOTES_TAB:
                return translate('Create new note')
            case MENTION_MODAL_TOPICS_TAB:
                return translate('Create new chat')
            case MENTION_MODAL_GOALS_TAB:
                return translate('Create new goal')
        }
    }

    return (
        <TouchableOpacity onPress={onPress}>
            <View
                style={[
                    localStyles.container,
                    activeTab !== MENTION_MODAL_CONTACTS_TAB && localStyles.containerRegular,
                    hover && localStyles.hover,
                ]}
            >
                <Icon name={'plus-square'} size={24} color={colors.Primary100} style={localStyles.icon} />
                <Text style={localStyles.text}>{getPlaceholderText()}</Text>
            </View>
        </TouchableOpacity>
    )
}

const localStyles = StyleSheet.create({
    container: {
        flexDirection: 'row',
        alignItems: 'center',
        height: 40,
        paddingLeft: 12,
        paddingRight: 8,
        paddingVertical: 8,
    },
    containerRegular: {
        paddingLeft: 8,
    },
    icon: {
        marginRight: 12,
    },
    text: {
        ...styles.body1,
        color: colors.Text03,
    },
    hover: {
        backgroundColor: colors.Secondary300,
        borderRadius: 4,
        borderWidth: 2,
        borderColor: colors.UtilityOrange150,
        borderStyle: 'dashed',
    },
})
