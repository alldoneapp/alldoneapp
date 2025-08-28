import React from 'react'
import { applyPopoverWidth } from '../../../../utils/HelperFunctions'
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { translate } from '../../../../i18n/TranslationService'
import CloseButton from '../../../FollowUp/CloseButton'
import styles, { colors } from '../../../styles/global'
import { useSelector } from 'react-redux'
import { ESTIMATION_TYPE_BOTH, ESTIMATION_TYPE_TIME } from '../../../../utils/EstimationHelper'
import URLTrigger from '../../../../URLSystem/URLTrigger'
import NavigationService from '../../../../utils/NavigationService'

export default function StatisticsByProjectAndEstimationType({
    title,
    subtitle,
    estimationType,
    statistics,
    hidePopover,
}) {
    const loggedUserId = useSelector(state => state.loggedUser.uid)
    const loggedUserProjects = useSelector(state =>
        state.loggedUserProjects.filter(
            project => project.estimationType === estimationType || estimationType === ESTIMATION_TYPE_BOTH
        )
    )

    const navigateDoneTasks = projectId => {
        URLTrigger.directProcessUrl(NavigationService, `/projects/${projectId}/user/${loggedUserId}/tasks/done`)
    }

    return (
        <View style={[localStyles.container, applyPopoverWidth()]}>
            <View style={localStyles.innerContainer}>
                <View style={localStyles.heading}>
                    <Text style={localStyles.title}>{translate(title)}</Text>
                    <Text style={localStyles.description}>{translate(subtitle)}</Text>
                </View>

                <View style={{ marginTop: 20, paddingHorizontal: 16 }}>
                    {loggedUserProjects.map((project, i) => {
                        return (
                            statistics[project.id] > 0 && (
                                <TouchableOpacity
                                    style={localStyles.itemContainer}
                                    onPress={() => navigateDoneTasks(project.id)}
                                    accessible={false}
                                >
                                    <View style={localStyles.itemWrapper}>
                                        <Text style={[styles.subtitle1, { color: 'white' }]} numberOfLines={1}>
                                            {project.name}
                                        </Text>
                                        <Text style={[styles.subtitle1, { color: 'white' }]}>
                                            {estimationType === ESTIMATION_TYPE_TIME
                                                ? statistics[project.id] / 60
                                                : statistics[project.id]}
                                        </Text>
                                    </View>
                                </TouchableOpacity>
                            )
                        )
                    })}
                </View>
            </View>
            <CloseButton close={hidePopover} />
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        flexDirection: 'column',
        width: 305,
        shadowColor: 'rgba(78, 93, 120, 0.56)',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 1,
        shadowRadius: 16,
        elevation: 3,
    },
    innerContainer: {
        flexDirection: 'column',
        borderRadius: 4,
        backgroundColor: colors.Secondary400,
    },
    heading: {
        flexDirection: 'column',
        paddingLeft: 16,
        paddingTop: 16,
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

    itemWrapper: {
        flex: 1,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        height: 40,
    },
    itemContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        height: 40,
    },
})
