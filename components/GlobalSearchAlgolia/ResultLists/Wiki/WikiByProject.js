import React, { useEffect, useRef } from 'react'
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native'

import Icon from '../../../Icon'
import styles, { colors } from '../../../styles/global'
import ProjectHeader from '../Common/ProjectHeader'
import { getWikiPagePath, goToObjectDetailView } from '../../searchFunctions'
import ProjectHelper from '../../../SettingsView/ProjectsSettings/ProjectHelper'

// The wiki pages of one project that match a global search. A hit carries the page's title and
// summary; its text is matched by the index but never sent to the browser, and the page itself is
// read again from Firestore when it opens, where a page hidden for a rebuild cannot be shown.
export default function WikiByProject({ project, pages, activeItemIndex, activeItemRef }) {
    const rowRefs = useRef({})

    useEffect(() => {
        const active = pages[activeItemIndex]
        if (activeItemRef && active) activeItemRef.current = rowRefs.current[active.id]
    }, [activeItemIndex])

    const open = page => {
        const { inactive, projectType } = ProjectHelper.checkIfProjectIdBelongsToInactiveProject(project.id)
        if (inactive) ProjectHelper.navigateToInactiveProject(projectType, getWikiPagePath(project.id, page.id))
        else goToObjectDetailView(project.id, page.id, 'wiki', 'wiki')
    }

    if (!pages || pages.length === 0) return null

    return (
        <View>
            <ProjectHeader project={project} amount={pages.length} />
            <View style={localStyles.list}>
                {pages.map((page, index) => (
                    <TouchableOpacity
                        key={page.id}
                        testID={`search-wiki-${page.id}`}
                        ref={ref => (rowRefs.current[page.id] = ref)}
                        style={[localStyles.row, index === activeItemIndex && localStyles.highlighted]}
                        onPress={() => open(page)}
                    >
                        <Icon name="book-open" size={24} color="#ffffff" />
                        <View style={localStyles.texts}>
                            <Text style={localStyles.title} numberOfLines={1}>
                                {page.title || page.id}
                            </Text>
                            {!!page.summary && (
                                <Text style={localStyles.summary} numberOfLines={2}>
                                    {page.summary}
                                </Text>
                            )}
                        </View>
                    </TouchableOpacity>
                ))}
            </View>
        </View>
    )
}

const localStyles = StyleSheet.create({
    list: {
        marginHorizontal: -8,
        paddingHorizontal: 16,
    },
    row: {
        flexDirection: 'row',
        alignItems: 'flex-start',
        padding: 8,
    },
    // Same keyboard highlight as the other result tabs (MentionsItems).
    highlighted: {
        backgroundColor: colors.Primary300,
        borderRadius: 4,
        borderWidth: 2,
        borderColor: colors.UtilityBlue150,
        borderStyle: 'dashed',
    },
    texts: {
        flex: 1,
        minWidth: 0,
        marginHorizontal: 8,
    },
    title: {
        ...styles.body1,
        color: '#ffffff',
    },
    summary: {
        ...styles.caption2,
        color: colors.Text03,
    },
})
