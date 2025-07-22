/**
 * @jest-environment jsdom
 */

import React from 'react'
import { render, fireEvent } from '@testing-library/react-native'
import NotificationModalMandatory from '../../../components/UIComponents/FloatModals/NotificationModalMandatory'

import renderer from 'react-test-renderer'

describe('NotificationModalMandatory component', () => {
    describe('NotificationModalMandatory snapshot test', () => {
        it('should render correctly', () => {
            const tree = renderer.create(<NotificationModalMandatory />).toJSON()
            expect(tree).toMatchSnapshot()
        })
    })

    describe('Clicking the resfresh button works', () => {
        it('test', async () => {
            const { findByTestId } = render(<NotificationModalMandatory />)
            const button = await findByTestId('refreshMandatory')
            fireEvent.press(button)
        })
    })
})
