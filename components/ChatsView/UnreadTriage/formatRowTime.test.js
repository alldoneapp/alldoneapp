import moment from 'moment'

import { formatRowTime } from './UnreadMessageRow'

jest.mock('../../UIComponents/FloatModals/DateFormatPickerModal', () => ({
    getDateFormat: () => 'DD.MM.YYYY',
    getTimeFormat: () => 'HH:mm',
}))
jest.mock('../../../i18n/TranslationService', () => ({ translate: key => key }))
jest.mock('../Utils/ChatHelper', () => ({ onOpenChat: jest.fn() }))
jest.mock('../../UIControls/SocialText/SocialText', () => () => null)
jest.mock('../../Icon', () => () => null)
jest.mock('../../../assets/svg/SVGGenericUser', () => () => null)
jest.mock('../../ContactsView/Utils/useGetUserPresentationData', () => () => ({}))
jest.mock('../unreadEmailArchiveContext', () => ({ useUnreadEmailArchiveContext: () => null }))

describe('formatRowTime (under the avatar, so it stays short)', () => {
    test('today is the time', () => {
        const today = moment().hour(9).minute(5)
        expect(formatRowTime(today.valueOf())).toBe('09:05')
    })

    test('this year is day and month', () => {
        const earlier = moment().startOf('year').add(2, 'days').hour(12)
        if (earlier.isSame(moment(), 'day')) earlier.add(1, 'day')
        expect(formatRowTime(earlier.valueOf())).toBe(earlier.format('DD.MM'))
    })

    test('before this year has a two-digit year', () => {
        expect(formatRowTime(moment('2024-03-07T10:00:00').valueOf())).toBe('07.03.24')
    })

    test('no time, no text', () => {
        expect(formatRowTime(0)).toBe('')
    })
})
