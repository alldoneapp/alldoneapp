import React from 'react'
import { StyleSheet, Text, TouchableOpacity, View, Image } from 'react-native'
import { useSelector } from 'react-redux'

import Icon from '../../../Icon'
import styles, { colors, hexColorToRGBa } from '../../../styles/global'
import { translate } from '../../../../i18n/TranslationService'
import { ALL_PROJECTS_OPTION } from './SelectProjectModalInSearch'

export default function AllProjectItem({ selectedProjectId, onProjectSelect, active }) {
    const photoURL = useSelector(state => state.loggedUser.photoURL)

    const onPress = () => {
        onProjectSelect(null, null, { id: ALL_PROJECTS_OPTION })
    }
    return (
        <View>
            <TouchableOpacity onPress={onPress}>
                <View style={[localStyles.container, active && localStyles.containerSelected]}>
                    <View style={localStyles.headerContainer}>
                        <Image style={localStyles.avatar} source={{ uri: photoURL }} />
                        <Text
                            numberOfLines={1}
                            style={[
                                styles.subtitle1,
                                localStyles.projectName,
                                active && localStyles.projectNameSelected,
                            ]}
                        >
                            {translate('All projects')}
                        </Text>
                    </View>

                    {selectedProjectId === ALL_PROJECTS_OPTION && (
                        <View style={[localStyles.checkContainer]}>
                            <Icon name="check" size={24} color="white" />
                        </View>
                    )}
                </View>
            </TouchableOpacity>
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingLeft: 8,
        paddingRight: 8,
    },
    containerSelected: {
        backgroundColor: hexColorToRGBa(colors.Text03, 0.16),
        borderRadius: 4,
    },
    headerContainer: {
        flex: 1,
        flexDirection: 'row',
        alignItems: 'center',
        paddingLeft: 4,
        paddingVertical: 16,
    },
    avatar: {
        width: 24,
        height: 24,
        borderRadius: 100,
        marginRight: 8,
    },
    checkContainer: {
        marginLeft: 'auto',
    },
    projectName: {
        color: '#ffffff',
    },
    projectNameSelected: {
        color: colors.Primary100,
    },
})
