import React from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { useDispatch, useSelector } from 'react-redux'

import styles, { colors } from '../styles/global'
import { translate } from '../../i18n/TranslationService'
import MainSectionTabsHeader from '../TaskListView/Header/MainSectionTabsHeader'
import { updateContactsActiveTab } from '../../redux/actions'
import { ALL_TAB, FOLLOWED_TAB } from '../Feeds/Utils/FeedsConstants'
import MultiToggleSwitch from '../UIControls/MultiToggleSwitch/MultiToggleSwitch'

const ContactsHeader = ({ contactAmount }) => {
    const dispatch = useDispatch()
    const contactsActiveTab = useSelector(state => state.contactsActiveTab)

    const parseText = number => {
        return translate(number > 1 ? 'Amount members' : 'Amount member', { amount: number })
    }

    return (
        <View style={localStyles.container}>
            <MainSectionTabsHeader
                showSectionToggle={true}
                renderSectionToggle={() => (
                    <MultiToggleSwitch
                        options={[
                            { icon: 'eye', text: 'Followed', badge: null },
                            { icon: 'users', text: 'All', badge: null },
                        ]}
                        currentIndex={contactsActiveTab}
                        onChangeOption={index =>
                            dispatch(updateContactsActiveTab(index === 0 ? FOLLOWED_TAB : ALL_TAB))
                        }
                    />
                )}
            />
            <Text style={[styles.caption2, localStyles.amountText, { color: colors.Text02 }]}>
                {parseText(contactAmount)}
            </Text>
        </View>
    )
}

export default ContactsHeader

const localStyles = StyleSheet.create({
    container: {
        width: '100%',
    },
    amountText: {
        textAlign: 'left',
        alignSelf: 'flex-start',
        marginTop: -8,
        paddingLeft: 12,
    },
})
