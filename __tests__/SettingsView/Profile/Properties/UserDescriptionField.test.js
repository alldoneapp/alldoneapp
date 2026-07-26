/**
 * @jest-environment jsdom
 */

import React from 'react'
import renderer, { act } from 'react-test-renderer'
import { useSelector } from 'react-redux'

import UserDescriptionField from '../../../../components/SettingsView/Profile/Properties/UserDescriptionField'

jest.mock('react-redux', () => ({
    useSelector: jest.fn(),
}))

jest.mock('../../../../components/Feeds/CommentsTextInput/CustomTextInput3', () => 'CustomTextInput3')
jest.mock('../../../../components/Feeds/CommentsTextInput/textInputHelper', () => ({
    TASK_THEME: {},
}))
jest.mock('../../../../components/UIControls/Button', () => 'Button')
jest.mock('../../../../i18n/TranslationService', () => ({
    translate: value => value,
}))

describe('UserDescriptionField', () => {
    beforeEach(() => {
        jest.clearAllMocks()
        useSelector.mockImplementation(selector =>
            selector({
                blockShortcuts: false,
                smallScreen: false,
            })
        )
    })

    it('renders the provided description', () => {
        const tree = renderer.create(<UserDescriptionField description="Current bio" onSave={jest.fn()} />)

        expect(tree.root.findByType('CustomTextInput3').props.initialTextExtended).toEqual('Current bio')
    })

    it('renders helper text when provided', () => {
        const tree = renderer.create(
            <UserDescriptionField
                description="Current bio"
                helperText="Global user description helper text"
                onSave={jest.fn()}
            />
        )

        expect(
            tree.root.findAllByType('Text').some(node => node.props.children === 'Global user description helper text')
        ).toBe(true)
    })

    it('trims the description before saving', async () => {
        const onSave = jest.fn().mockResolvedValue()
        const tree = renderer.create(<UserDescriptionField description="  Updated bio  " onSave={onSave} />)

        await act(async () => {
            await tree.root.findByType('Button').props.onPress()
        })

        expect(onSave).toHaveBeenCalledWith('Updated bio')
    })
})
