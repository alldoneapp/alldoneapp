import React from 'react'
import renderer from 'react-test-renderer'
import { StyleSheet } from 'react-native'

import GeneralTasksHeader, { GENERAL_TASKS_HEADER_MIN_HEIGHT } from './GeneralTasksHeader'
import globalStyles from '../../styles/global'
import { PROJECT_COLOR_DEFAULT } from '../../../Themes/Modern/ProjectColors'

jest.mock('../../../i18n/TranslationService', () => ({
    translate: key => key,
}))
jest.mock('../../SettingsView/ProjectsSettings/ProjectHelper', () => ({
    getProjectById: jest.fn(),
}))

const ProjectHelper = require('../../SettingsView/ProjectsSettings/ProjectHelper')

const LONG_PROJECT_NAME = 'JTL Software - Project Juno'

const render = (name = LONG_PROJECT_NAME) => {
    ProjectHelper.getProjectById.mockReturnValue({ id: 'p1', name, color: PROJECT_COLOR_DEFAULT })
    return renderer.create(<GeneralTasksHeader projectId="p1" />).root
}

const flatten = node => StyleSheet.flatten(node.props.style)

const parts = root => {
    const views = root.findAllByType(require('react-native').View)
    const texts = root.findAllByType(require('react-native').Text)
    return { container: views[0], blockContainer: views[1], block: views[2], title: texts[0] }
}

describe('GeneralTasksHeader (AT-2399 mobile layout)', () => {
    it('renders the translated label together with the project name', () => {
        const { title } = parts(render())
        expect(title.props.children.flat().join('')).toBe(`General tasks: ${LONG_PROJECT_NAME}`)
    })

    // The defect: the row was `height: 40`, so a project name long enough to wrap produced
    // 2 x lineHeight 24 = 48px of text inside a 40px box, and the text was painted across the
    // card border rather than the card giving way.
    it('never pins the row to a fixed height', () => {
        const { container } = parts(render())
        const style = flatten(container)

        expect(style.height).toBeUndefined()
        expect(style.minHeight).toBe(GENERAL_TASKS_HEADER_MIN_HEIGHT)
    })

    it('keeps the title on one line and truncates it', () => {
        const { title } = parts(render())

        expect(title.props.numberOfLines).toBe(1)
    })

    // With numberOfLines={1} react-native-web sets `white-space: nowrap`, so the title's
    // min-content width is the WHOLE untruncated string. A flex item's `min-width` defaults to
    // `auto` = min-content, and react-native-web gives `View` a `minWidth: 0` but not `Text` —
    // so without an explicit one the title refuses to shrink and overflows the row sideways
    // instead of showing an ellipsis.
    it('lets the title shrink below its own text width, which is what makes it ellipsize', () => {
        const { title } = parts(render())
        const style = flatten(title)

        expect(style.flex).toBe(1)
        expect(style.minWidth).toBe(0)
    })

    it('stays exactly one line tall for a title that fits', () => {
        const { title, container } = parts(render())
        const style = flatten(title)

        // One line plus its vertical margin has to fit inside the row, or the "single line"
        // contract silently becomes "grows the row by a few pixels".
        const titleBoxHeight = globalStyles.body1.lineHeight + 2 * style.marginVertical
        const rowContentHeight = GENERAL_TASKS_HEADER_MIN_HEIGHT - 2 * flatten(container).borderWidth
        expect(titleBoxHeight).toBeLessThanOrEqual(rowContentHeight)
    })

    it('stretches the coloured block panel over the full row height', () => {
        const { blockContainer } = parts(render())
        const style = flatten(blockContainer)

        // Mirrors GoalProgressBar's height: '100%'. A fixed height here would leave the panel
        // floating in the middle of the card if the row ever grew.
        expect(style.height).toBeUndefined()
        expect(style.alignSelf).toBe('stretch')
    })

    it('keeps the progress block pinned to the first line, matching a real goal row', () => {
        const { blockContainer, block, container } = parts(render())
        const blockContainerStyle = flatten(blockContainer)
        const containerStyle = flatten(container)

        expect(blockContainerStyle.alignItems).toBe('flex-start')
        // GoalProgressWrapper offsets GoalProgress by marginTop: 4 from the card edge.
        expect(blockContainerStyle.paddingTop + containerStyle.borderWidth).toBe(4)
        expect(flatten(block).height).toBe(32)
    })

    it('keeps the 61px left column that lines the title up with goal titles', () => {
        const { blockContainer, block } = parts(render())
        const blockContainerStyle = flatten(blockContainer)

        // GoalProgressBar renders 61px wide when a goal is at 0%.
        const columnWidth = blockContainerStyle.paddingLeft + flatten(block).width + blockContainerStyle.paddingRight
        expect(columnWidth).toBe(61)
    })

    it('renders nothing when the project is unknown', () => {
        ProjectHelper.getProjectById.mockReturnValue(undefined)
        expect(renderer.create(<GeneralTasksHeader projectId="missing" />).toJSON()).toBeNull()
    })
})
