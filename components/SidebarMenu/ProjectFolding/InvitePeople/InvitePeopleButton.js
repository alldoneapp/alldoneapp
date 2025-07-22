import React from 'react'
import { StyleSheet, Text, TouchableOpacity } from 'react-native'
import { useSelector } from 'react-redux'

import { colors } from '../../../styles/global'
import useOnHover from '../../../../hooks/UseOnHover'
import { getTheme } from '../../../../Themes/Themes'
import { Themes } from '../../Themes'
import Icon from '../../../Icon'
import { translate } from '../../../../i18n/TranslationService'
import useCollapsibleSidebar from '../../Collapsible/UseCollapsibleSidebar'

export default function InvitePeopleButton({ projectColor, openModal }) {
    const themeName = useSelector(state => state.loggedUser.themeName)
    const { expanded } = useCollapsibleSidebar()
    const { hover, onHover, offHover } = useOnHover()

    const theme = getTheme(
        Themes,
        themeName,
        'CustomSideMenu.ProjectList.ProjectItem.ProjectSectionList.ProjectSectionItem.InvitePeopleButton'
    )

    return (
        <TouchableOpacity
            style={[
                localStyles.container,
                hover ? theme.containerActive(projectColor) : theme.container(projectColor),
                !expanded && localStyles.containerCollapsed,
            ]}
            onMouseEnter={onHover}
            onMouseLeave={offHover}
            onPress={openModal}
        >
            <Icon size={20} name={'user-plus'} color={theme.placeholder.color} style={localStyles.icon} />
            {expanded && (
                <Text style={[localStyles.placeholderText, theme.placeholder]} numberOfLines={1}>
                    {translate('Add AI Human')}
                </Text>
            )}
        </TouchableOpacity>
    )
}

const localStyles = StyleSheet.create({
    container: {
        alignItems: 'center',
        flexDirection: 'row',
        height: 48,
        paddingLeft: 26,
    },
    containerCollapsed: {
        paddingLeft: 17,
    },
    icon: {
        height: 20,
        width: 20,
        marginRight: 10,
        opacity: 0.5,
    },
    placeholderText: {
        ...style.body2,
        lineHeight: 20,
        flexWrap: 'nowrap',
        opacity: 0.5,
    },

    dataContainer: {
        paddingHorizontal: 15,
        height: 48,
        alignItems: 'center',
        flexDirection: 'row',
    },
    text: {
        flex: 1,
        marginLeft: 10,
        flexDirection: 'row',
        alignItems: 'center',
        textAlignVertical: 'center',
        color: 'white',
    },
    textInput: {
        marginLeft: 10,
        paddingTop: 1,
    },
    containerTexting: {
        borderTopWidth: 1,
        borderLeftWidth: 1,
        borderRightWidth: 1,
        borderTopLeftRadius: 4,
        borderTopRightRadius: 4,
        paddingHorizontal: 14,
        height: 47,
    },
    buttonContainer: {
        backgroundColor: colors.Primary350,
        borderBottomLeftRadius: 4,
        borderBottomRightRadius: 4,
        alignItems: 'flex-end',
        justifyContent: 'center',
        paddingRight: 8,
        marginBottom: 4,
        borderBottomColor: colors.Secondary200,
        borderBottomWidth: 2,
    },
    actionButton: {
        width: 48,
        height: 40,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: colors.Secondary200,
        borderRadius: 4,
    },
    topSpace: {
        width: '100%',
        height: 4,
        backgroundColor: colors.Secondary200,
    },
})
