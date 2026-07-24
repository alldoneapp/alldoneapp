/**
 * @jest-environment jsdom
 */

import React from 'react'
import EditContact from '../../components/ContactsView/EditContact'
import renderer from 'react-test-renderer'
import Backend from '../../utils/BackendBridge'

describe('EditContact component', () => {
    it('should render correctly when is a new contact', () => {
        const tree = renderer.create(<EditContact isNew={true} />).toJSON()
        expect(tree).toMatchSnapshot()
    })

    it('should render correctly when is not a new contact', () => {
        const mockFunc = jest.fn()
        URL.createObjectURL = mockFunc
        const tree = renderer.create(<EditContact isNew={false} contact={{}} />).toJSON()
        expect(tree).toMatchSnapshot()
    })

    it('should render unmount correctly', () => {
        const tree = renderer.create(<EditContact isNew={false} contact={{}} />)
        tree.unmount()
    })

    it('should call cancelAction when press Enter', () => {
        // Given
        const mockFn = jest.fn()
        const tree = renderer.create(<EditContact isNew={false} contact={{ displayName: 'Samuel' }}
            onCancelAction={mockFn} />)
        const instance = tree.getInstance()
        // When
        instance.onInputKeyPress({ nativeEvent: { key: 'Enter' } })
        // Then
        expect(mockFn).toBeCalledTimes(1)
    })

    it('should call cancelAction when press Enter and the name of the contact is empty', () => {
        // Given
        const mockFn = jest.fn()
        const tree = renderer.create(<EditContact isNew={false} contact={{ displayName: '' }}
            onCancelAction={mockFn} />)
        const instance = tree.getInstance()
        // When
        instance.onInputKeyPress({ nativeEvent: { key: 'Enter' } })
        // Then
        expect(mockFn).toBeCalledTimes(1)
    })

    it.each([
        ['name', 'Peter'],
        ['age', 10],
    ])
        ('should update the contact fields with field=%p, value=%p', (field, value) => {
            // Given
            const tree = renderer.create(<EditContact isNew={false} contact={{ displayName: 'Samuel' }} />)
            const instance = tree.getInstance()
            // When
            instance.updateContactField(field, value)
            // Then
            expect(instance.state.tmpContact[field]).toEqual(value)
        })

    it('should change the displayName when the input text changes', () => {
        // Given
        const tree = renderer.create(<EditContact isNew={false} contact={{ displayName: 'John' }} />)
        const instance = tree.getInstance()
        // When
        instance.onChangeInputText('Peter')
        // Then
        expect(instance.state.tmpContact['displayName']).toEqual('Peter')
    })

    it('should change the privacy correctly', () => {
        // Given
        const tree = renderer.create(<EditContact isNew={false} contact={{ displayName: 'John' }} />)
        const instance = tree.getInstance()
        const prevValue = instance.state.tmpContact['isPrivate']
        // When
        instance.changePrivacy()
        // Then
        expect(instance.state.tmpContact['isPrivate']).toEqual(!prevValue)
    })


    it('should the company correctly', () => {
        // Given
        const tree = renderer.create(<EditContact isNew={false} contact={{ displayName: 'John' }} />)
        const instance = tree.getInstance()
        // When
        instance.changeCompany('aleph.engineering')
        // Then
        expect(instance.state.tmpContact['company']).toEqual('aleph.engineering')
    })

    it('should call Backend.addContactToProject correctly ', () => {
        // Given
        Backend.addContactToProject = jest.fn()
        const tree = renderer.create(<EditContact isNew={false} contact={{ displayName: 'John' }}
            onCancelAction={() => { }} />)
        const instance = tree.getInstance()
        instance.state.contactChanged = true
        // When
        instance.addProjectContact()
        // Then
        expect(Backend.addContactToProject).toBeCalledTimes(1)
    })
})
