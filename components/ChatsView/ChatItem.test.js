import { getChatItemBackgroundColor } from './chatItemBackground'

describe('ChatItem background color', () => {
    it('uses the comment-popup tint instead of white in a comment popup', () => {
        expect(getChatItemBackgroundColor('#FFFFFF', true)).toBe('#1A3289')
    })

    it('keeps the normal list background outside a comment popup', () => {
        expect(getChatItemBackgroundColor('#FFFFFF', false)).toBe('#ffffff')
    })

    it('uses the same popup background for highlighted chats', () => {
        expect(getChatItemBackgroundColor('#FFE6C7', true)).toBe('#1A3289')
    })

    it('preserves an explicit chat highlight color outside the popup', () => {
        expect(getChatItemBackgroundColor('#FFE6C7', false)).toBe('#FFE6C7')
    })
})
