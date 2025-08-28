import React from 'react'
import { StyleSheet, Text, View } from 'react-native'
import styles, { colors } from '../../../styles/global'
import TabsList from './TabsList'
import CloseButton from '../../../FollowUp/CloseButton'

export default function Header({ setActiveTab, activeTab, delayClosePopover, title, description, showTabs }) {
    const close = event => {
        event.preventDefault()
        event.stopPropagation()
        delayClosePopover()
    }

    return (
        <View>
            <View style={localStyles.container}>
                <Text style={localStyles.title}>{title}</Text>
                <Text style={localStyles.description}>{description}</Text>
            </View>
            {showTabs && <TabsList setActiveTab={setActiveTab} activeTab={activeTab} />}
            <CloseButton style={{ top: -4 }} close={close} />
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        marginBottom: 20,
        paddingLeft: 16,
        paddingRight: 16,
    },
    title: {
        ...styles.title7,
        color: '#ffffff',
    },
    description: {
        ...styles.body2,
        color: colors.Text03,
    },
})
