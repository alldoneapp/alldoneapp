import React from 'react'
import { View } from 'react-native'

import { PROJECT_COLOR_DEFAULT, PROJECT_COLOR_SYSTEM } from '../../Themes/Modern/ProjectColors'
import {
    ProjectSectionContext,
    ProjectSectionAccentContext,
    ProjectSectionBorderContext,
    TaskHierarchyBackgroundContext,
    taskHierarchyStyles,
} from './TaskHierarchy'

export function getProjectPalette(color) {
    return PROJECT_COLOR_SYSTEM[color] || PROJECT_COLOR_SYSTEM[PROJECT_COLOR_DEFAULT]
}

export default function ProjectSection({ projectColor, children, style, embedded = false, selected = false }) {
    const backgroundColor = getProjectPalette(projectColor).PROJECT_ITEM_SECTION
    const accentColor = getProjectPalette(projectColor).PROJECT_ITEM_SECTION_HEADER
    const borderColor = getProjectPalette(projectColor).PROJECT_ITEM_SECTION_ACTIVE

    // Assistant timelines already live inside the project's outer section.
    if (embedded) return <>{children}</>

    return (
        <ProjectSectionContext.Provider value={true}>
            <TaskHierarchyBackgroundContext.Provider value={backgroundColor}>
                <ProjectSectionAccentContext.Provider value={accentColor}>
                    <ProjectSectionBorderContext.Provider value={borderColor}>
                        <View
                            style={[
                                taskHierarchyStyles.project,
                                { backgroundColor, marginBottom: 24 },
                                selected && { marginTop: 24 },
                                style,
                            ]}
                        >
                            {children}
                        </View>
                    </ProjectSectionBorderContext.Provider>
                </ProjectSectionAccentContext.Provider>
            </TaskHierarchyBackgroundContext.Provider>
        </ProjectSectionContext.Provider>
    )
}

export function ProjectSectionBody({ children, style }) {
    return <View style={[taskHierarchyStyles.projectBody, style]}>{children}</View>
}
