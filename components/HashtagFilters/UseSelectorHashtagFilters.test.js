import React from 'react'
import renderer, { act } from 'react-test-renderer'
import { useDispatch, useSelector } from 'react-redux'

import useSelectorHashtagFilters from './UseSelectorHashtagFilters'

jest.mock('react-redux', () => ({ useDispatch: jest.fn(), useSelector: jest.fn() }))

describe('useSelectorHashtagFilters', () => {
    it('keeps the derived array stable while the filter map is unchanged', () => {
        const hashtagFilters = new Map([['roadmap', true]])
        const arrays = []
        useDispatch.mockReturnValue(jest.fn())
        useSelector.mockImplementation(selector => selector({ hashtagFilters }))

        const Harness = ({ renderNumber }) => {
            const [, hashtagFiltersArray] = useSelectorHashtagFilters()
            arrays.push(hashtagFiltersArray)
            return <span>{renderNumber}</span>
        }

        let tree
        act(() => {
            tree = renderer.create(<Harness renderNumber={1} />)
        })
        act(() => {
            tree.update(<Harness renderNumber={2} />)
        })

        expect(arrays).toHaveLength(2)
        expect(arrays[1]).toBe(arrays[0])
    })
})
