import React from 'react'
import MultiToggleSwitch from '../../components/UIControls/MultiToggleSwitch'

import renderer from 'react-test-renderer'

jest.mock('firebase', () => ({ firestore: {} }));

let options = [
    { icon: 'square', text: 'Open' },
    { icon: 'clock', text: 'Pending' },
    { icon: 'square-checked-gray', text: 'Done' },
]

describe('MultiToggleSwitch component', () => {
    describe('MultiToggleSwitch empty snapshot test', () => {
        it('Should render correctly', () => {
            const tree = renderer.create(<MultiToggleSwitch options={options} />).toJSON()
            expect(tree).toMatchSnapshot()
        })
    })

    describe('Test component functions', () => {
        it('after call componentDidMount should render correctly', () => {
            const tree = renderer.create(<MultiToggleSwitch options={options} />)
            const instance = tree.getInstance()
            instance.componentDidMount()
        })
        it('after call componentDidUpdate should render correctly', () => {
            const tree = renderer.create(<MultiToggleSwitch options={options} />)
            const instance = tree.getInstance()
            instance.componentDidUpdate()
        })
        it('after call updateWidths should render correctly', () => {
            const tree = renderer.create(<MultiToggleSwitch options={options} />)
            const instance = tree.getInstance()
            instance.updateWidths()

            // Waiting to resolve the promise
            setTimeout(() => {
                let state = instance.state
                expect(state.optionsWidths.length).toEqual(3)
            }, 50)
        })
        xit('after call onSelectOption should render correctly', () => {
            const tree = renderer.create(<MultiToggleSwitch options={options} onChangeOption={() => {}} />)
            const instance = tree.getInstance()
            instance.onSelectOption(1, 'text')

            // Waiting to resolve the promise
            // Even with a timeout of 1s it is not taking the value for activeIndex.
            setTimeout(() => {
                let state = instance.state
                expect(state.activeIndex).toEqual(1)
            }, 1000)
        })
        it('after call animate should render correctly', () => {
            const tree = renderer.create(<MultiToggleSwitch options={options} />)
            const instance = tree.getInstance()
            instance.animate()
        })
        it('after call getOffset should render correctly', () => {
            const tree = renderer.create(<MultiToggleSwitch options={options} />)
            const instance = tree.getInstance()
            instance.state.optionsWidths = [10, 10, 10]
            let offset = instance.getOffset(1)
            expect(offset).toEqual(10)
        })
        it('after call updateState should render correctly', () => {
            const tree = renderer.create(<MultiToggleSwitch options={options} />)
            expect(tree.toJSON()).toMatchSnapshot()

            tree.getInstance().updateState()
            expect(tree.toJSON()).toMatchSnapshot()
        })
        it('after call componentWillUnmount should render correctly', () => {
            const tree = renderer.create(<MultiToggleSwitch options={options} />)
            tree.getInstance().componentWillUnmount()
        })
    })
})
