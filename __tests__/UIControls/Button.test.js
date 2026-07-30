import React from 'react'
import Button from '../../components/UIControls/Button'

import renderer from 'react-test-renderer'

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
