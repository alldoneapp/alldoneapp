import React from 'react'
import AdvancedTextInput from '../../components/UIControls/AdvancedTextInput'

import renderer from 'react-test-renderer'

describe('AdvancedTextInput component', () => {
    describe('AdvancedTextInput empty snapshot test', () => {
        it('Should render correctly', () => {
            const tree = renderer.create(<AdvancedTextInput />).toJSON()
            expect(tree).toMatchSnapshot()
        })
    })

    describe('Functions of AdvancedTextInput', () => {
        describe('Function cleanBreakLines', () => {
            xit('Should execute correctly', () => {
                const tree = renderer.create(<AdvancedTextInput />)
                const instance = tree.getInstance()

                const content = `content task
with a line`
                const result = instance.cleanBreakLines(content)

                expect(result).toEqual('content task with a line')
            })
        })

        describe('Function onLayoutChange', () => {
            xit('Should execute correctly', () => {
                const tree = renderer.create(<AdvancedTextInput />)
                const instance = tree.getInstance()

                instance.setState({ inputHeight: 100 })
                const event = { nativeEvent: { layout: { height: 50 } } }
                instance.onLayoutChange(event)

                expect(instance.state.inputHeight).toEqual(50)
            })
        })

        describe('Function onContentSizeChange', () => {
            xit('Should execute correctly', () => {
                const tree = renderer.create(<AdvancedTextInput />)
                const instance = tree.getInstance()

                instance.setState({ inputHeight: 100 })
                const event = { nativeEvent: { contentSize: { height: 60 } } }
                instance.onContentSizeChange(event)

                expect(instance.state.inputHeight).toEqual(60)
            })
        })

        describe('Function onChangeText', () => {
            xit('Should execute correctly', () => {
                const tree = renderer.create(<AdvancedTextInput />)
                const instance = tree.getInstance()

                const content = `content lorem ipsum`
                instance.onChangeText(content)

                expect(instance.state.content).toEqual('content lorem ipsum')
            })
        })
    })
})
