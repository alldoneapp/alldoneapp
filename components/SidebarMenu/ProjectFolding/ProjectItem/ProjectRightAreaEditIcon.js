import React from 'react'
import { useSelector, useDispatch } from 'react-redux'
import { TouchableOpacity, View } from 'react-native'

import { getTheme } from '../../../../Themes/Themes'
import { Themes } from '../../Themes'
import NavigationService from '../../../../utils/NavigationService'
import Icon from '../../../Icon'
import { setSelectedNavItem } from '../../../../redux/actions'
import { DV_TAB_PROJECT_PROPERTIES } from '../../../../utils/TabNavigationConstants'

export default function ProjectRightAreaEditIcon({ projectIndex }) {
    const dispatch = useDispatch()
    const themeName = useSelector(state => state.loggedUser.themeName)

    const theme = getTheme(Themes, themeName, 'CustomSideMenu.ProjectList.ProjectItem.ProjectItemAmount')

    return (
        <View style={{ alignSelf: 'flex-end' }}>
            <TouchableOpacity
                onPress={() => {
                    NavigationService.navigate('ProjectDetailedView', {
                        projectIndex,
                    })
                    dispatch(setSelectedNavItem(DV_TAB_PROJECT_PROPERTIES))
                }}
            >
                <Icon name="edit-2" size={18} color={theme.amountActive.color} />
            </TouchableOpacity>
        </View>
    )
}
