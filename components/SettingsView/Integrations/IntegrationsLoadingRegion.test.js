import React from 'react'
import renderer, { act } from 'react-test-renderer'
import { ActivityIndicator, Text, View } from 'react-native'

import IntegrationsLoadingRegion, {
    IntegrationsPendingContent,
    useIsInsideIntegrationsLoadingRegion,
    visibleCenterOffset,
} from './IntegrationsLoadingRegion'

jest.mock('../../styles/global', () => ({
    __esModule: true,
    default: { subtitle1: {}, subtitle2: {}, body2: {}, caption1: {}, title6: {} },
    colors: { Grey300: '#ddd', Primary100: '#00f' },
}))
jest.mock('../../../i18n/TranslationService', () => ({ translate: value => value }))
jest.mock('../../UIComponents/Spinner', () => {
    const React = require('react')
    return props => React.createElement('MockSpinner', props)
})

function spinners(tree) {
    return tree.root.findAllByType('MockSpinner')
}

function overlay(tree) {
    return tree.root.findAll(node => node.props.testID === 'integrations-loading-spinner')[0]
}

function Section({ loadingKey, pending }) {
    const inside = useIsInsideIntegrationsLoadingRegion()
    return (
        <IntegrationsPendingContent loadingKey={loadingKey} pending={pending}>
            <Text>{loadingKey}</Text>
            {pending && !inside && <ActivityIndicator size="small" />}
        </IntegrationsPendingContent>
    )
}

function renderRegion(props) {
    let tree
    act(() => {
        tree = renderer.create(
            <IntegrationsLoadingRegion>
                <Section loadingKey="a" pending={props.a} />
                <Section loadingKey="b" pending={props.b} />
            </IntegrationsLoadingRegion>
        )
    })
    return tree
}

describe('IntegrationsLoadingRegion', () => {
    test('renders exactly one shared spinner while any section is loading', () => {
        const tree = renderRegion({ a: true, b: true })

        expect(spinners(tree)).toHaveLength(1)
        // Sections must not fall back to their own local spinner inside a region.
        expect(tree.root.findAllByType(ActivityIndicator)).toHaveLength(0)
    })

    test('keeps the single spinner while only one section is still loading', () => {
        const tree = renderRegion({ a: false, b: true })

        expect(spinners(tree)).toHaveLength(1)
    })

    test('removes the spinner once every section has loaded', () => {
        const tree = renderRegion({ a: false, b: false })

        expect(spinners(tree)).toHaveLength(0)
        expect(overlay(tree)).toBeUndefined()
    })

    test('dims and disables only the sections that are still loading', () => {
        const tree = renderRegion({ a: true, b: false })
        const [pendingSection, loadedSection] = tree.root
            .findAllByType(View)
            .filter(node => 'pointerEvents' in node.props)

        expect(pendingSection.props.pointerEvents).toBe('none')
        expect(JSON.stringify(pendingSection.props.style)).toContain('0.4')
        expect(loadedSection.props.pointerEvents).toBe('auto')
        expect(JSON.stringify(loadedSection.props.style)).not.toContain('0.4')
    })

    test('keeps loaded content rendered while a sibling loads, so nothing pops in', () => {
        const tree = renderRegion({ a: true, b: true })
        const output = JSON.stringify(tree.toJSON())

        expect(output).toContain('a')
        expect(output).toContain('b')
    })

    test('drops a section from the pending set when it unmounts mid-load', () => {
        let tree
        act(() => {
            tree = renderer.create(
                <IntegrationsLoadingRegion>
                    <Section loadingKey="a" pending={true} />
                </IntegrationsLoadingRegion>
            )
        })
        expect(spinners(tree)).toHaveLength(1)

        act(() => {
            tree.update(<IntegrationsLoadingRegion>{null}</IntegrationsLoadingRegion>)
        })
        expect(spinners(tree)).toHaveLength(0)
    })

    test('falls back to a strict centre when the DOM cannot be measured', () => {
        const tree = renderRegion({ a: true, b: true })
        const style = JSON.stringify(overlay(tree).props.style)

        expect(style).toContain('absolute')
        expect(style).toContain('"top":0')
        expect(style).toContain('"bottom":0')
    })

    test('reports no region for sections rendered standalone (keeps its own fallback spinner)', () => {
        let inside = null
        function Probe() {
            inside = useIsInsideIntegrationsLoadingRegion()
            return null
        }
        act(() => {
            renderer.create(<Probe />)
        })

        expect(inside).toBe(false)
    })
})

describe('visibleCenterOffset', () => {
    const VIEWPORT = 800

    test('centres on the region itself when it fits fully on screen', () => {
        // 400px tall region starting 100px down: centre is 200px from its top.
        expect(visibleCenterOffset({ top: 100, bottom: 500 }, VIEWPORT)).toBe(200)
    })

    test('centres on the visible slice when the region runs past the fold', () => {
        // 3000px region starting at the top: only 0..800 is visible, so 400px from its top —
        // NOT 1500px, which would put the spinner far below the fold.
        expect(visibleCenterOffset({ top: 0, bottom: 3000 }, VIEWPORT)).toBe(400)
    })

    test('centres on the visible slice when the region starts above the fold', () => {
        // Scrolled down: rows -1000..2000 visible as 0..800 → 1400px from the region's top.
        expect(visibleCenterOffset({ top: -1000, bottom: 2000 }, VIEWPORT)).toBe(1400)
    })

    test('falls back to the region centre when it is scrolled fully above the fold', () => {
        // 300px region entirely above the viewport → its own centre, and never negative.
        expect(visibleCenterOffset({ top: -400, bottom: -100 }, VIEWPORT)).toBe(150)
    })

    test('falls back to the region centre when it is scrolled fully below the fold', () => {
        expect(visibleCenterOffset({ top: 1000, bottom: 1400 }, VIEWPORT)).toBe(200)
    })
})
