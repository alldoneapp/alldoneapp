/**
 * @jest-environment jsdom
 */

import React from 'react'
import MyPlatform from '../components/MyPlatform'
import { Platform, Text } from 'react-native'

import renderer from 'react-test-renderer'

describe('MyPlatform utility', () => {
    describe('isMobile method', () => {
        it('should correctly indicate that Android is a mobile platform', () => {
            Platform.OS = 'android'
            expect(MyPlatform.isMobile).toBeTruthy()
        })

        it('should correctly indicate that iOS is a mobile platform', () => {
            Platform.OS = 'ios'
            expect(MyPlatform.isMobile).toBeTruthy()
        })

        it('should correctly indicate that Web is NOT a mobile platform', () => {
            Platform.OS = 'web'
            expect(MyPlatform.isMobile).toBeFalsy()
        })
    })

    describe('getUserAgentName method', () => {
        it('should identify the edge browser', () => {
            expect(MyPlatform.getUserAgentName('Microsoft Edge')).toEqual('edge')
        })
        it('should identify the opera browser', () => {
            expect(MyPlatform.getUserAgentName('Opera [opr]')).toEqual('opera')
        })
        it('should identify the chrome browser', () => {
            expect(MyPlatform.getUserAgentName('Google Chrome')).toEqual('chrome')
        })
        it('should identify the ie browser', () => {
            expect(MyPlatform.getUserAgentName('IE Trident')).toEqual('ie')
        })
        it('should identify the firefox browser', () => {
            expect(MyPlatform.getUserAgentName('Mozilla Firefox')).toEqual('firefox')
        })
        it('should identify the safari browser', () => {
            expect(MyPlatform.getUserAgentName('Apple Safari')).toEqual('safari')
        })
        it('should identify the other browser', () => {
            expect(MyPlatform.getUserAgentName('other browser')).toEqual('other')
        })
    })

    describe('browserType method', () => {
        it('should identify the other browser', () => {
            expect(MyPlatform.browserType).toEqual('other')
        })
    })

    describe('getElementWidth method', () => {
        it('should return the correct width', () => {
            const tree = renderer.create(<Text>My new text</Text>)
            MyPlatform.getElementWidth(tree.getInstance().current).then(width => {
                expect(width).toEqual(10)
            })
        })
    })
})
