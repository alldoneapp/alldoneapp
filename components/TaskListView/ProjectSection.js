import React from 'react'
import { Animated, StyleSheet, View } from 'react-native'

import { PROJECT_COLOR_DEFAULT, PROJECT_COLOR_SYSTEM } from '../../Themes/Modern/ProjectColors'
import ProjectLineDisintegration from './Header/ProjectLineDisintegration'
import useProjectCompletedSweepMotion, { useProjectLineExit } from './OpenTasksView/projectCompletedSweepMotion'
import {
    ProjectSectionContext,
    ProjectSectionAccentContext,
    ProjectSectionBorderContext,
    ProjectSectionMotionContext,
    TaskHierarchyBackgroundContext,
    taskHierarchyStyles,
} from './TaskHierarchy'

export function getProjectPalette(color) {
    return PROJECT_COLOR_SYSTEM[color] || PROJECT_COLOR_SYSTEM[PROJECT_COLOR_DEFAULT]
}

export default function ProjectSection({
    projectColor,
    children,
    style,
    embedded = false,
    selected = false,
    completedSweepRunId = 0,
    completedSweepLineWillLeave = false,
}) {
    const backgroundColor = getProjectPalette(projectColor).PROJECT_ITEM_SECTION
    const accentColor = getProjectPalette(projectColor).PROJECT_ITEM_SECTION_HEADER
    const borderColor = getProjectPalette(projectColor).PROJECT_ITEM_SECTION_ACTIVE

    // Assistant timelines already live inside the project's outer section.
    if (embedded) return <>{children}</>

    return (
        <ProjectSectionSurface
            accentColor={accentColor}
            backgroundColor={backgroundColor}
            borderColor={borderColor}
            projectColor={projectColor}
            selected={selected}
            style={style}
            completedSweepRunId={completedSweepRunId}
            completedSweepLineWillLeave={completedSweepLineWillLeave}
        >
            {children}
        </ProjectSectionSurface>
    )
}

function ProjectSectionSurface({
    accentColor,
    backgroundColor,
    borderColor,
    projectColor,
    selected,
    style,
    children,
    completedSweepRunId,
    completedSweepLineWillLeave,
}) {
    /**
     * AT-2535 — the exit belongs to the complete rounded project card. The earlier implementation
     * lived in `ProjectHeader`, which became only the top 57px after project sections gained a
     * rounded surface and padded body. Masking and collapsing this node keeps the header sweep,
     * body surface and rounded corners together. The particles remain a sibling so the mask cannot
     * erase them as they lift away.
     */
    const motion = useProjectCompletedSweepMotion(completedSweepRunId, completedSweepLineWillLeave)
    const baseStyle = [
        taskHierarchyStyles.project,
        { backgroundColor, marginBottom: 24 },
        selected && { marginTop: 24 },
        style,
    ]
    const bottomSpacing = StyleSheet.flatten(baseStyle).marginBottom || 0
    // `onLayout` excludes margins. Feed the resolved spacing to the exit explicitly so it closes
    // continuously instead of disappearing in one final jump when the held card unmounts.
    const { exitStyle, exitHeight, onLineLayout } = useProjectLineExit(motion, bottomSpacing)

    return (
        <ProjectSectionContext.Provider value={true}>
            <TaskHierarchyBackgroundContext.Provider value={backgroundColor}>
                <ProjectSectionAccentContext.Provider value={accentColor}>
                    <ProjectSectionBorderContext.Provider value={borderColor}>
                        <ProjectSectionMotionContext.Provider value={motion}>
                            <View style={localStyles.exitContainer}>
                                <Animated.View
                                    style={[baseStyle, exitStyle]}
                                    onLayout={onLineLayout}
                                    testID="project-section"
                                >
                                    {children}
                                </Animated.View>
                                {exitStyle && (
                                    <ProjectLineDisintegration
                                        progress={motion.disintegrate}
                                        height={exitHeight}
                                        tint={projectColor || PROJECT_COLOR_DEFAULT}
                                    />
                                )}
                            </View>
                        </ProjectSectionMotionContext.Provider>
                    </ProjectSectionBorderContext.Provider>
                </ProjectSectionAccentContext.Provider>
            </TaskHierarchyBackgroundContext.Provider>
        </ProjectSectionContext.Provider>
    )
}

export function ProjectSectionBody({ children, style }) {
    return <View style={[taskHierarchyStyles.projectBody, style]}>{children}</View>
}

const localStyles = StyleSheet.create({
    exitContainer: {
        position: 'relative',
    },
})
