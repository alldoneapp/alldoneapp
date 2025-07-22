/**
 * @jest-environment jsdom
 */

import React, { useState as useStateMock } from 'react'
import LoadingJokes from '../components/LoadingJokes'
import ReactDOM from 'react-dom'
import { act } from 'react-dom/test-utils'
import HelperFunctions from '../utils/HelperFunctions'

let container
let mockStatic

beforeEach(() => {
    jest.mock('../utils/HelperFunctions')
    container = document.createElement('div')
    document.body.appendChild(container)
    mockStatic = jest.fn()
    mockStatic.mockReturnValue(0)
    HelperFunctions.getRandomInteger = mockStatic
})

afterEach(() => {
    document.body.removeChild(container)
    container = null
})

describe('LoadingJokes component', () => {
    describe('LoadingJokes snapshot test', () => {
        it('should render correctly', () => {
            act(() => {
                ReactDOM.render(<LoadingJokes />, container)
            })
            expect(container).toMatchSnapshot()
        })
    })

    jest.useFakeTimers()

    describe('Set interval function test', () => {
        it('Function is called 2 and when pass 1 second', () => {
            act(() => {
                ReactDOM.render(<LoadingJokes />, container)
            })

            expect(setInterval).toHaveBeenCalledTimes(2)
            expect(setInterval).toHaveBeenLastCalledWith(expect.any(Function), 1000)
        })
    })
})
