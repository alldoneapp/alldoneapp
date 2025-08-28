import React from 'react'
import { useSelector } from 'react-redux'
import { View, StyleSheet } from 'react-native'

import styles from '../styles/global'
import TemplatesMarketplace from './TemplatesMarketplace'
import { checkIfUserIsGuideAdmin } from '../Guides/guidesHelper'
import GuideProjectsListCreators from './GuideProjectsListCreators'
import GuideProjectsListUsers from './GuideProjectsListUsers'

export default function GuideProjects({ navigation }) {
    const loggedUser = useSelector(state => state.loggedUser)

    const isGuideAdmin = checkIfUserIsGuideAdmin(loggedUser)

    return (
        <View>
            {isGuideAdmin ? (
                <GuideProjectsListCreators navigation={navigation} />
            ) : (
                <GuideProjectsListUsers navigation={navigation} />
            )}
            <TemplatesMarketplace />
        </View>
    )
}

const localStyles = StyleSheet.create({
    titleContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        height: 32,
        paddingLeft: 24,
        paddingBottom: 4,
        marginTop: 32,
        alignItems: 'center',
    },
    text: {
        ...styles.body1,
    },
})
