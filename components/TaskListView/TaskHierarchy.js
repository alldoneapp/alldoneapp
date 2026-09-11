import React, { createContext, useContext } from 'react'
import { StyleSheet, View } from 'react-native'
import { colors } from '../styles/global'

// Shared board presentation. Project sections supply their surface color; standalone
// rows retain a white surface without changing their interactions.
export const TaskHierarchyContext = createContext(true)
export const ProjectSectionContext = createContext(false)
export const HeaderActionsContext = createContext(false)
export const TaskHierarchyBackgroundContext = createContext('#FFFFFF')
export const ProjectSectionAccentContext = createContext(undefined)
export const ProjectSectionLastCommentTintContext = createContext(undefined)
export const ProjectSectionBorderContext = createContext(undefined)
export const useProjectSectionAccent = () => useContext(ProjectSectionAccentContext)
export const useProjectSectionLastCommentTint = () => useContext(ProjectSectionLastCommentTintContext)
export const useProjectSectionBorder = () => useContext(ProjectSectionBorderContext)
export const useTaskHierarchyBackground = () => useContext(TaskHierarchyBackgroundContext)
export const useTaskHierarchy = () => useContext(TaskHierarchyContext)

export function TaskHierarchyGroup({ children, style, pointerEvents, borderColor, bottomSpacing = 8 }) {
    const enabled = useTaskHierarchy()
    const projectBorderColor = useProjectSectionBorder()
    const outlineColor = borderColor || projectBorderColor
    return (
        <View
            style={[
                style,
                enabled && taskHierarchyStyles.group,
                enabled && taskHierarchyStyles.goalGroup,
                enabled && { paddingBottom: bottomSpacing },
                enabled && outlineColor && { borderColor: outlineColor },
            ]}
            pointerEvents={pointerEvents}
        >
            {children}
            <TaskHierarchyGoalOutline borderColor={outlineColor} />
        </View>
    )
}

// Draw the edge above row backgrounds without clipping swipe actions or popovers.
export function TaskHierarchyGoalOutline({ borderColor } = {}) {
    const enabled = useTaskHierarchy()
    const projectBorderColor = useProjectSectionBorder()
    const outlineColor = borderColor || projectBorderColor
    return enabled ? (
        <View
            pointerEvents="none"
            style={[taskHierarchyStyles.goalOutline, outlineColor && { borderColor: outlineColor }]}
        />
    ) : null
}

export const taskHierarchyStyles = StyleSheet.create({
    project: {
        borderRadius: 12,
    },
    projectHeader: {
        borderBottomWidth: 0,
        borderRadius: 12,
    },
    projectHeaderContent: {
        paddingTop: 0,
        paddingBottom: 0,
        paddingHorizontal: 12,
        alignItems: 'center',
    },
    headerAddButton: {
        height: 32,
        borderRadius: 8,
        borderWidth: 0,
        backgroundColor: colors.UtilityBlue200,
        paddingHorizontal: 10,
        alignSelf: 'center',
    },
    headerAddButtonMobile: {
        width: 36,
        height: 36,
        paddingHorizontal: 0,
    },
    headerAddText: {
        color: '#FFFFFF',
        marginRight: 0,
    },
    headerSecondaryButton: {
        height: 32,
        borderRadius: 8,
        borderWidth: 0,
        backgroundColor: 'rgba(255, 255, 255, 0.85)',
        paddingHorizontal: 10,
        alignSelf: 'center',
    },
    headerMoreButton: {
        width: 32,
        height: 32,
        minWidth: 32,
        minHeight: 32,
        borderRadius: 8,
        backgroundColor: 'rgba(255, 255, 255, 0.85)',
    },
    headerMoreButtonMobile: {
        width: 36,
        height: 36,
        minWidth: 36,
        minHeight: 36,
    },
    headerMoreWrapper: {
        marginLeft: 6,
        marginTop: 0,
        alignSelf: 'center',
    },
    projectBody: {
        paddingHorizontal: 8,
        paddingBottom: 12,
    },
    group: {
        backgroundColor: '#F6F7F9',
        borderRadius: 8,
        paddingHorizontal: 0,
        paddingBottom: 8,
        paddingTop: 4,
    },
    goalGroup: {
        backgroundColor: 'transparent',
        borderWidth: 1,
        borderColor: '#DDE4EB',
        paddingTop: 0,
        paddingBottom: 0,
    },
    goalRowOutline: {
        position: 'absolute',
        top: -1,
        bottom: 0,
        left: -1,
        right: -1,
        borderWidth: 1,
        borderColor: '#DDE4EB',
        borderRadius: 8,
        zIndex: 1,
    },
    goalOutline: {
        position: 'absolute',
        top: -1,
        bottom: -1,
        left: -1,
        right: -1,
        borderWidth: 1,
        borderColor: '#DDE4EB',
        borderRadius: 8,
        zIndex: 1,
    },
    taskFamily: {
        backgroundColor: 'transparent',
        borderRadius: 6,
        marginVertical: 4,
        paddingBottom: 6,
    },
    subtasks: {
        marginLeft: 0,
    },
})
