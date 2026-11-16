import React from 'react'
import renderer, { act } from 'react-test-renderer'
import { Text } from 'react-native'

import AnalyticsConsent from './AnalyticsConsent'
import { __resetAnalyticsForTests, __setAnalyticsEnabledForTests } from '../../../../utils/analytics/analytics'

afterEach(() => __resetAnalyticsForTests())

const texts = tree => tree.root.findAllByType(Text).map(node => [node.props.children].flat().join(''))

// The cookie settings live here since 2026-11-16; the sidebar's footer no longer links to them.
describe('AnalyticsConsent', () => {
    it('is the "Cookie settings" row, with the same choice as the consent dialog', () => {
        __setAnalyticsEnabledForTests(true)
        let tree
        act(() => {
            tree = renderer.create(<AnalyticsConsent />)
        })
        expect(texts(tree)).toEqual(expect.arrayContaining(['Cookie settings', 'Necessary only', 'Allow analytics']))
    })

    it('stays away where analytics is off', () => {
        __setAnalyticsEnabledForTests(false)
        let tree
        act(() => {
            tree = renderer.create(<AnalyticsConsent />)
        })
        expect(tree.toJSON()).toBeNull()
    })
})
