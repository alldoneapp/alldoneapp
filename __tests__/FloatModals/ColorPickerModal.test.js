import React from 'react'
import { Provider } from 'react-redux'
import renderer from 'react-test-renderer'

import ColorPickerModal from '../../components/UIComponents/FloatModals/ColorPickerModal'
import store from '../../redux/store'

// selectColor used to be a method on the class; it is a prop now, so the
// behaviour is driven through the rendered swatches instead of an instance.
const render = (props = {}) =>
    renderer.create(
        <Provider store={store}>
            <ColorPickerModal closePopover={() => {}} {...props} />
        </Provider>
    )

describe('ColorPickerModal component', () => {
    it('Should render correctly', () => {
        expect(render().toJSON()).toMatchSnapshot()
    })

    it('hands the chosen colour back to its caller', () => {
        const selectColor = jest.fn()
        const tree = render({ selectColor })

        const pressables = tree.root.findAll(node => typeof node.props.onPress === 'function')
        expect(pressables.length).toBeGreaterThan(0)

        renderer.act(() => {
            pressables[0].props.onPress()
        })

        expect(selectColor).toHaveBeenCalled()
    })
})
