// Offline author data: each id has its own avatar; the third exercises the SVG fallback.
const photo = color =>
    `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24"><rect width="24" height="24" fill="${color}"/></svg>`)}`
export const creators = {
    anna: { displayName: 'Anna Alldone', photoURL: photo('#546F58'), isAssistant: true },
    carl: {
        displayName: 'Carl Code Mentor mit einem sehr langen Assistentennamen',
        photoURL: photo('#4E74D1'),
        isAssistant: true,
    },
    unknown: { displayName: 'Assistant', isAssistant: true },
}
export default function useGetUserPresentationData(id) {
    return creators[id]
}
export { getTimestampInMilliseconds } from '../../components/ChatsView/Utils/messageTimestamps'
export const TEXT_ELEMENT = 'text'
export const HASH_ELEMENT = 'hash'
export const URL_ELEMENT = 'url'
export const MENTION_ELEMENT = 'mention'
export const EMAIL_ELEMENT = 'email'
export const parseFeedComment = text => [{ type: TEXT_ELEMENT, text }]
