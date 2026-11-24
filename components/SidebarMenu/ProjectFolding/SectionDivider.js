import React from 'react'
import { StyleSheet, View } from 'react-native'
import { useSelector } from 'react-redux'

import { getTheme } from '../../../Themes/Themes'
import { Themes } from '../Themes'
import useCollapsibleSidebar from '../Collapsible/UseCollapsibleSidebar'

// AT-3139: a quiet line between the main sections (Tasks … Chats) and the rest (Artifacts, Wiki,
// settings). It is 1px tall and sits on the section rows' own background, so the list keeps its
// spacing and no strip of sidebar colour shows between the rows.
export default function SectionDivider({ projectColor }) {
    const themeName = useSelector(state => state.loggedUser.themeName)
    const { expanded } = useCollapsibleSidebar()

    const theme = getTheme(
        Themes,
        themeName,
        'CustomSideMenu.ProjectList.ProjectItem.ProjectSectionList.ProjectSectionItem.SectionItemLayout'
    )

    return (
        <View
            testID="sidebar-section-divider"
            style={[localStyles.container, theme.container(projectColor), !expanded && localStyles.collapsed]}
        >
            <View style={[localStyles.line, theme.divider]} />
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        height: 1,
        paddingHorizontal: 24,
    },
    collapsed: {
        paddingHorizontal: 12,
    },
    line: {
        flex: 1,
    },
})
