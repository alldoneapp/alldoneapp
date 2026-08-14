/**
 * @jest-environment jsdom
 */

import React from 'react'
import { Text, View } from 'react-native'
import DismissibleItem from '../../components/UIComponents/DismissibleItem'

import renderer from 'react-test-renderer'
import { nodeMockOptions } from '../../testUtils/domNodeStub'

describe('DismissibleItem component', () => {
    describe('DismissibleItem empty snapshot test', () => {
        it('Should render correctly', () => {
            const tree = renderer
                .create(<DismissibleItem modalComponent={<Text />} defaultComponent={<View />} />, nodeMockOptions)
                .toJSON()
            expect(tree).toMatchSnapshot()
        })
    })

    describe('Function toggleModal snapshot test', () => {
        it('Should execute and render correctly', () => {
            const tree = renderer.create(
                <DismissibleItem modalComponent={<Text />} defaultComponent={<View />} />,
                nodeMockOptions
            )
            expect(tree.toJSON()).toMatchSnapshot()

            // show modal
            const instance = tree.getInstance()
            instance.toggleModal()
            expect(tree.toJSON()).toMatchSnapshot()

            // hide modal
            instance.toggleModal()
            expect(tree.toJSON()).toMatchSnapshot()
        })
    })
})
