import React from 'react'
import Button from '../../components/UIControls/Button'
import { StyleSheet, Text } from 'react-native'

import renderer from 'react-test-renderer'

jest.mock('../../redux/store', () => ({
    getState: () => ({ showShortcuts: false, showFloatPopup: 0 }),
    subscribe: () => jest.fn(),
}))
jest.mock('../../components/Feeds/CommentsTextInput/MentionsModal/GoalProgress', () => 'GoalProgress')

describe('Button component', () => {
    describe('Button empty snapshot test', () => {
        it('Should render correctly', () => {
            const tree = renderer.create(<Button />).toJSON()
            expect(tree).toMatchSnapshot()
        })
    })

    describe('getMasterStyle function', () => {
        xit('Should return the correct master style', () => {
            const tree = renderer.create(<Button />)

            const masterStyle = {
                btnStyle: [
                    {
                        flexDirection: 'row',
                        flexWrap: 'nowrap',
                        paddingVertical: 8,
                        paddingHorizontal: 16,
                        height: 40,
                        maxHeight: 40,
                        minHeight: 40,
                        borderRadius: 4,
                        backgroundColor: '#04142F',
                        alignItems: 'center',
                        justifyContent: 'center',
                        alignSelf: 'flex-start',
                    },
                ],
                textStyle: [
                    {
                        flexWrap: 'nowrap',
                        fontFamily: 'Roboto-Medium',
                        fontSize: 14,
                        lineHeight: 16,
                        letterSpacing: 0.8,
                        color: '#FFFFFF',
                        alignSelf: 'center',
                        paddingVertical: 0,
                        paddingHorizontal: 8,
                        margin: 0,
                    },
                ],
                iconStyle: '#ffffff',
            }

            const style = tree.getInstance().getMasterStyle()
            expect(style).toEqual(masterStyle)
        })
    })

    describe('Button primary with title and icon snapshot test', () => {
        it('Should render correctly', () => {
            const tree = renderer.create(<Button type={'primary'} title={'Upload'} icon={'chevron-up'} />).toJSON()
            expect(tree).toMatchSnapshot()
        })
    })

    it('renders a small secondary label below the button title', () => {
        const tree = renderer.create(<Button title="Send forward" subtitle="Final review" />)
        const labels = tree.root.findAllByType(Text)

        expect(labels.map(label => label.props.children)).toEqual(['Send forward', 'Final review'])
        expect(labels[1].props.numberOfLines).toBe(1)
        expect(StyleSheet.flatten(labels[1].props.style)).toMatchObject({
            fontFamily: 'Roboto-Regular',
            fontSize: 11,
            lineHeight: 14,
            opacity: 0.72,
        })
    })

    // AT-2223: a compact button (12px icon next to a 12px label) needs a tighter icon/label gap
    // than the 40px default, and the gap is set in render(), out of reach of `titleStyle`.
    describe('icon/label gap', () => {
        const labelMargin = tree =>
            StyleSheet.flatten(
                tree.root.findAllByType(Text).find(label => label.props.children === 'Accept all').props.style
            ).marginLeft

        it('keeps the 12px gap when no override is given', () => {
            expect(labelMargin(renderer.create(<Button title="Accept all" icon={'check'} />))).toBe(12)
        })

        it('applies an explicit iconGap', () => {
            expect(labelMargin(renderer.create(<Button title="Accept all" icon={'check'} iconGap={4} />))).toBe(4)
        })

        it('still collapses the gap on a button with no icon at all', () => {
            expect(labelMargin(renderer.create(<Button title="Accept all" iconGap={4} />))).toBe(0)
        })
    })

    describe('Button text with only icon and disabled snapshot test', () => {
        it('Should render a red text button correctly', () => {
            const tree = renderer
                .create(<Button type={'text'} textColor={'red'} icon={'save'} disabled={true} />)
                .toJSON()
            expect(tree).toMatchSnapshot()
        })
        it('Should render a blue text button correctly', () => {
            const tree = renderer.create(<Button type={'text'} icon={'save'} disabled={true} />).toJSON()
            expect(tree).toMatchSnapshot()
        })
    })

    describe('Function buildFinalStyle snapshot test', () => {
        xit('Should render correctly after function execution', () => {
            const tree = renderer.create(<Button type={'ghost'} title={'Next'} titleStyle={{ color: '#555555' }} />)

            tree.getInstance().buildFinalStyle('ghost', 'Next', null, false, 'blue', {}, {})
            expect(tree.toJSON()).toMatchSnapshot()
        })
    })
})
