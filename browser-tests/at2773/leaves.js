// Only backend-dependent tags/actions are stubbed. Markdown, code, tables,
// the message body, motion hooks, React Native Web and app CSS are shipped code.
export default () => null
export const translate = text => text
export const resolveUnsubscribeUrl = () => null
export const openUrlInNewTab = () => {}
export const markAlldoneChatsReadForLinkedEmails = () => {}
export const TEXT_ELEMENT = 'text'
export const HASH_ELEMENT = 'hash'
export const URL_ELEMENT = 'url'
export const MENTION_ELEMENT = 'mention'
export const EMAIL_ELEMENT = 'email'
export const BREAKLINE_CODE = 'BREAKLINE'
export const REGEX_BOT_CODE = /```(.*?)```/g
export const REGEX_BOT_BOLD = /\*\*(.*?)\*\*/g
export const parseFeedComment = text =>
    text
        .trim()
        .split(/\s+/)
        .filter(Boolean)
        .map(text => ({ type: 'text', text }))
