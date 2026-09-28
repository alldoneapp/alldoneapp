import React from 'react'
import renderer from 'react-test-renderer'
import { StyleSheet } from 'react-native'
import moment from 'moment'

import { EmptyInboxOverview } from './AchievementsArea'
import { canRenderSkyline } from './Skyline/webglSupport'

jest.mock('../../../../i18n/TranslationService', () => ({ translate: key => key }))
jest.mock('../../../UIComponents/FloatModals/DateFormatPickerModal', () => ({ getTimeFormat: () => 'HH:mm' }))
jest.mock('./Skyline/webglSupport', () => ({ canRenderSkyline: jest.fn() }))
jest.mock('./Skyline/EmptyInboxSkyline', () => {
    const { View } = require('react-native')
    return props => <View testID="skyline-double" {...props} />
})

const render = (emptyInboxDays = ['2026-01-02']) => {
    let tree
    renderer.act(() => {
        tree = renderer.create(<EmptyInboxOverview user={{ uid: 'u1', emptyInboxDays }} />)
    })
    return tree
}

const texts = tree =>
    tree.root.findAll(node => typeof node.props.children === 'string').map(node => node.props.children)

describe('Empty inbox card: 3D skyline vs 2D grid', () => {
    it('draws the city instead of the grid when the browser can render WebGL', () => {
        canRenderSkyline.mockReturnValue(true)
        localStorage.clear()
        const tree = render()
        const skyline = tree.root.findAllByProps({ testID: 'skyline-double' }, { deep: false })

        expect(skyline).toHaveLength(1)
        expect(skyline[0].props.emptyInboxDays).toEqual(['2026-01-02'])
        // Until the user picks a range, the card opens on the current week.
        expect(skyline[0].props.weeks).toBe(1)
        expect(texts(tree)).toContain('Empty inbox skyline week description')
        expect(texts(tree)).not.toContain('Monday short')
    })

    it('switches between the week and month cities and the year grid, and remembers the choice', () => {
        canRenderSkyline.mockReturnValue(true)
        localStorage.clear()
        const tree = render()
        const press = id =>
            renderer.act(() => {
                tree.root.findByProps({ testID: id }).props.onPress()
            })

        press('empty-inbox-range-year')
        expect(tree.root.findAllByProps({ testID: 'skyline-double' })).toHaveLength(0)
        expect(texts(tree)).toContain('Monday short')
        expect(texts(tree)).toContain('Empty inbox achievement description')
        expect(localStorage.getItem('alldone.emptyInbox.range')).toBe('year')

        // A new card opens on the stored choice.
        expect(render().root.findAllByProps({ testID: 'skyline-double' })).toHaveLength(0)

        press('empty-inbox-range-month')
        const month = tree.root.findAllByProps({ testID: 'skyline-double' }, { deep: false })
        expect(month).toHaveLength(1)
        expect(month[0].props.weeks).toBe(5)
        expect(texts(tree)).toContain('Empty inbox skyline description')
        expect(localStorage.getItem('alldone.emptyInbox.range')).toBe('month')

        press('empty-inbox-range-week')
        expect(tree.root.findAllByProps({ testID: 'skyline-double' }, { deep: false })[0].props.weeks).toBe(1)
        localStorage.clear()
    })

    it('rings today in the year grid even on a day the inbox was cleared', () => {
        canRenderSkyline.mockReturnValue(true)
        localStorage.setItem('alldone.emptyInbox.range', 'year')
        const tree = render([moment().format('YYYY-MM-DD')])
        const today = tree.root.findAllByProps({ accessibilityLabel: 'Empty inbox reached on' }, { deep: false })
        expect(today).toHaveLength(1)
        const style = StyleSheet.flatten(today[0].props.style)
        expect(style.borderWidth).toBe(2)
        expect(style.borderColor).toBe('#007FFF')
        localStorage.clear()
    })

    it('keeps the 2D grid when it cannot', () => {
        canRenderSkyline.mockReturnValue(false)
        const tree = render()

        expect(tree.root.findAllByProps({ testID: 'skyline-double' })).toHaveLength(0)
        expect(texts(tree)).toContain('Empty inbox achievement description')
        expect(texts(tree)).toContain('Monday short')
        // No switch without a city to switch to.
        expect(tree.root.findAllByProps({ testID: 'empty-inbox-range-year' })).toHaveLength(0)
    })
})
