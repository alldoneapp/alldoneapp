import React from 'react'
import renderer, { act } from 'react-test-renderer'

import ProjectSection, { getProjectPalette } from './ProjectSection'
import {
    useProjectSectionAccent,
    useProjectSectionLastCommentTint,
    useTaskHierarchy,
    useTaskHierarchyBackground,
} from './TaskHierarchy'
import { PROJECT_COLOR_BLUE, PROJECT_COLOR_RED, PROJECT_COLOR_DEFAULT } from '../../Themes/Modern/ProjectColors'

function SurfaceProbe() {
    return <Surface hierarchy={useTaskHierarchy()} color={useTaskHierarchyBackground()} />
}
function Surface() {
    return null
}

function ProjectTintProbe() {
    return <ProjectTint accent={useProjectSectionAccent()} lastComment={useProjectSectionLastCommentTint()} />
}
function ProjectTint() {
    return null
}

it('uses the shared hierarchy outside the All Projects task board', () => {
    const tree = renderer.create(<SurfaceProbe />)
    expect(tree.root.findByType(Surface).props).toEqual({ hierarchy: true, color: '#FFFFFF' })
    act(() => tree.unmount())
})

it('updates descendant row surfaces when the project color changes', () => {
    const tree = renderer.create(
        <ProjectSection projectColor={PROJECT_COLOR_BLUE}>
            <SurfaceProbe />
        </ProjectSection>
    )
    expect(tree.root.findByType(Surface).props.color).toBe(getProjectPalette(PROJECT_COLOR_BLUE).PROJECT_ITEM_SECTION)
    act(() =>
        tree.update(
            <ProjectSection projectColor={PROJECT_COLOR_RED}>
                <SurfaceProbe />
            </ProjectSection>
        )
    )
    expect(tree.root.findByType(Surface).props.color).toBe(getProjectPalette(PROJECT_COLOR_RED).PROJECT_ITEM_SECTION)
    act(() => tree.unmount())
})

it('supplies the adjacent darker palette tint for last comments', () => {
    const tree = renderer.create(
        <ProjectSection projectColor={PROJECT_COLOR_BLUE}>
            <ProjectTintProbe />
        </ProjectSection>
    )

    expect(tree.root.findByType(ProjectTint).props).toEqual({
        accent: getProjectPalette(PROJECT_COLOR_BLUE).PROJECT_ITEM_SECTION_HEADER,
        lastComment: getProjectPalette(PROJECT_COLOR_BLUE).PROJECT_ITEM_ACTIVE,
    })

    act(() =>
        tree.update(
            <ProjectSection projectColor={PROJECT_COLOR_RED}>
                <ProjectTintProbe />
            </ProjectSection>
        )
    )
    expect(tree.root.findByType(ProjectTint).props).toEqual({
        accent: getProjectPalette(PROJECT_COLOR_RED).PROJECT_ITEM_SECTION_HEADER,
        lastComment: getProjectPalette(PROJECT_COLOR_RED).PROJECT_ITEM_ACTIVE,
    })
    act(() => tree.unmount())
})

it('lets embedded assistant timelines inherit the outer project surface', () => {
    const tree = renderer.create(
        <ProjectSection projectColor={PROJECT_COLOR_RED}>
            <ProjectSection projectColor={PROJECT_COLOR_BLUE} embedded>
                <SurfaceProbe />
            </ProjectSection>
        </ProjectSection>
    )
    expect(tree.root.findByType(Surface).props.color).toBe(getProjectPalette(PROJECT_COLOR_RED).PROJECT_ITEM_SECTION)
    act(() => tree.unmount())
})

it('falls back to the default palette for a project without a known color', () => {
    expect(getProjectPalette(undefined)).toBe(getProjectPalette(PROJECT_COLOR_DEFAULT))
    expect(getProjectPalette('unknown')).toBe(getProjectPalette(PROJECT_COLOR_DEFAULT))
})
