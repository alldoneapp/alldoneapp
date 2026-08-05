import React from 'react'
import { Image } from 'react-native'
import renderer, { act } from 'react-test-renderer'

import ContactPhoto from './ContactPhoto'
import Spinner from '../UIComponents/Spinner'

jest.mock('../UIComponents/Spinner', () => 'Spinner')

describe('ContactPhoto', () => {
    it('keeps its image callbacks stable while loading state changes', () => {
        let tree
        act(() => {
            tree = renderer.create(<ContactPhoto uri="contact.jpg" style={{ width: 48, height: 48 }} />)
        })

        const image = tree.root.findByType(Image)
        const onLoadStart = image.props.onLoadStart
        const onLoadEnd = image.props.onLoadEnd

        act(() => onLoadStart())

        const loadingImage = tree.root.findByType(Image)
        expect(loadingImage.props.onLoadStart).toBe(onLoadStart)
        expect(loadingImage.props.onLoadEnd).toBe(onLoadEnd)
        expect(loadingImage.props.style).toEqual(expect.arrayContaining([{ display: 'none' }]))
        expect(tree.root.findAllByType(Spinner)).toHaveLength(1)

        act(() => onLoadEnd())

        expect(tree.root.findByType(Image).props.style).toEqual(expect.arrayContaining([{ display: 'flex' }]))
        expect(tree.root.findAllByType(Spinner)).toHaveLength(0)
    })
})
