/**
 * @jest-environment jsdom
 */

import React from 'react'
import { Provider } from 'react-redux'
import EditContact from '../../components/ContactsView/EditContact'
import renderer from 'react-test-renderer'
import store from '../../redux/store'

// The notes field embeds the Quill editor, whose unmount cleanup dereferences
// a ref that never gets an editor here. Nothing in this suite is about the
// editor, so stand it in.
jest.mock('../../components/Feeds/CommentsTextInput/CustomTextInput3', () => 'CustomTextInput3')

// EditContact is still a class, but the fields it renders read redux through
// hooks, so a Provider has to sit above it. That makes the Provider the root,
// so the instance comes from a ref rather than tree.getInstance().
const render = (props = {}) => {
    const ref = React.createRef()
    const tree = renderer.create(
        <Provider store={store}>
            <EditContact ref={ref} {...props} />
        </Provider>
    )
    return { tree, instance: ref.current }
}

describe('EditContact component', () => {
    it('should render correctly when is a new contact', () => {
        expect(render({ isNew: true }).tree.toJSON()).toMatchSnapshot()
    })

    it('should render correctly when is not a new contact', () => {
        URL.createObjectURL = jest.fn()

        expect(render({ isNew: false, contact: {} }).tree.toJSON()).toMatchSnapshot()
    })

    it('should render unmount correctly', () => {
        const { tree } = render({ isNew: false, contact: {} })

        expect(() => tree.unmount()).not.toThrow()
    })

    it('should dismiss the editor on submit', () => {
        const dismissibleRef = { toggleModal: jest.fn() }
        const { instance } = render({ isNew: false, contact: { displayName: 'Samuel' }, dismissibleRef })

        instance.onSubmit()

        expect(dismissibleRef.toggleModal).toHaveBeenCalledTimes(1)
    })

    it('should dismiss the editor on submit when the name of the contact is empty', () => {
        const dismissibleRef = { toggleModal: jest.fn() }
        const { instance } = render({ isNew: false, contact: { displayName: '' }, dismissibleRef })

        instance.onSubmit()

        expect(dismissibleRef.toggleModal).toHaveBeenCalledTimes(1)
    })

    it.each([
        ['name', 'Peter'],
        ['age', 10],
    ])('should update the contact fields with field=%p, value=%p', (field, value) => {
        const { instance } = render({ isNew: false, contact: { displayName: 'Samuel' } })

        instance.updateContactField(field, value)

        expect(instance.state.tmpContact[field]).toEqual(value)
    })

    it('should change the displayName when the input text changes', () => {
        const { instance } = render({ isNew: false, contact: { displayName: 'John' } })

        instance.onChangeInputText('Peter')

        expect(instance.state.tmpContact['displayName']).toEqual('Peter')
    })

    it('should change the privacy correctly', () => {
        const { instance } = render({ isNew: false, contact: { displayName: 'John' } })

        instance.setPrivacyBeforeSave(true, ['user-1'])

        expect(instance.state.tmpContact['isPrivate']).toBe(true)
        expect(instance.state.tmpContact['isPublicFor']).toEqual(['user-1'])
    })

    it('should the company correctly', () => {
        const { instance } = render({ isNew: false, contact: { displayName: 'John' } })

        instance.updateContactField('company', 'aleph.engineering')

        expect(instance.state.tmpContact['company']).toEqual('aleph.engineering')
    })

    it('should mark the contact as changed when a field is edited', () => {
        const { instance } = render({ isNew: false, contact: { displayName: 'John' } })

        instance.onChangeInputText('Peter')

        expect(instance.state.contactChanged).toBe(true)
    })
})
