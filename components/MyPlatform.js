import { Platform } from 'react-native'

export default class MyPlatform {
    static get isMobile() {
        return Platform.OS === 'android' || Platform.OS === 'ios'
    }

    static get isDesktop() {
        const userAgent = navigator.userAgent.toLowerCase()
        return (
            userAgent.indexOf('win') !== -1 ||
            (userAgent.indexOf('linux') !== -1 && !(userAgent.indexOf('android') !== -1)) ||
            ((!navigator.maxTouchPoints || navigator.maxTouchPoints <= 2) && /Mac/.test(navigator.platform))
        )
    }

    static get browserType() {
        return MyPlatform.getUserAgentName(!MyPlatform.isMobile && window.navigator.userAgent)
    }

    static get osType() {
        return MyPlatform.getOSFromUserAgent(!MyPlatform.isMobile && window.navigator)
    }

    static getUserAgentName(userAgent = '') {
        let test = regexp => {
            return regexp.test(userAgent)
        }

        switch (true) {
            case test(/edg/i):
                return 'edge'
            case test(/opr/i):
                return 'opera'
            case test(/chrome/i):
                return 'chrome'
            case test(/trident/i):
                return 'ie'
            case test(/firefox/i):
                return 'firefox'
            case test(/safari/i):
                return 'safari'
            default:
                return 'other'
        }
    }

    static getOSFromUserAgent(navigator) {
        const userAgent = navigator.userAgent.toLowerCase()
        const platform = navigator.platform

        if (userAgent.indexOf('win') !== -1) {
            return 'windows'
        }

        if (/(Mac|iPhone|iPod|iPad)/i.test(navigator.platform)) {
            return 'mac'
        }

        return 'other'
    }

    static getElementWidth = element =>
        new Promise(resolve => {
            if (element !== null) {
                element.measureInWindow((x, y, width) => {
                    resolve(width)
                })
            } else {
                resolve(0)
            }
        })

    static getElementDimensions = element =>
        new Promise(resolve => {
            if (element !== null) {
                element.measureInWindow((x, y, width, height) => {
                    resolve({ x, y, width, height })
                })
            } else {
                resolve(0)
            }
        })
}
