const assert = require('assert')
const { cleanTextMetaData, getMentionData } = require('../Utils/parseTextUtils')

const run = () => {
    const withUserAndAvatar = 'Hi @JohnM2mVOSjAVPPKweLDoe#uid123###https://cdn.example.com/avatar.png'
    assert.strictEqual(cleanTextMetaData(withUserAndAvatar, true), 'Hi @John Doe')

    const withAvatarOnly = 'Ping @JaneM2mVOSjAVPPKweLDoe###https://cdn.example.com/avatar.png now'
    assert.strictEqual(cleanTextMetaData(withAvatarOnly, true), 'Ping @Jane Doe now')

    const legacyMention = '@AlexM2mVOSjAVPPKweLSmith#user-1'
    const { userId, mentionText } = getMentionData(legacyMention, true)
    assert.strictEqual(userId, 'user-1')
    assert.strictEqual(mentionText, '@Alex Smith')

    const lowercaseSpaceCodeMention = '@Christianm2mvosjavppkwelBallerstaller#user-2'
    const parsedLowercaseMention = getMentionData(lowercaseSpaceCodeMention, true)
    assert.strictEqual(parsedLowercaseMention.userId, 'user-2')
    assert.strictEqual(parsedLowercaseMention.mentionText, '@Christian Ballerstaller')

    console.log('parseTextUtils mention parsing tests passed')
}

if (require.main === module) run()

// The file ends in .test.js, so Jest collects it and would otherwise fail
// the suite for having no tests. Running it as one keeps the assertions
// meaningful in both places.
if (typeof test === 'function') test('parseTextUtils mention parsing', run)

module.exports = { run }

describe('stripMarkdownForPreview', () => {
    const { stripMarkdownForPreview } = require('../Utils/parseTextUtils')

    test('a heading line does not stay a "##" for the hashtag parser, also on a later line', () => {
        expect(stripMarkdownForPreview('Intro\n## Ergebnis: Gemergt\nMR 893 ist **gemergt**.')).toBe(
            'Intro Ergebnis: Gemergt MR 893 ist gemergt.'
        )
    })

    test('drops inline code, emphasis, quotes, list markers and link syntax', () => {
        expect(stripMarkdownForPreview('> Der Job `deploy:web` lief *nicht*\n- [Pipeline](https://x.y/1)')).toBe(
            'Der Job deploy:web lief nicht Pipeline'
        )
    })

    test('keeps hashtags, mentions, code block content and encoded media tokens', () => {
        const image = 'O2TI5plHBf1QfdYaO2TI5plHBf1QfdYbO2TI5plHBf1QfdYcO2TI5plHBf1QfdYd'
        expect(stripMarkdownForPreview(`#release für @Jana_Becker ${image}\n\`\`\`js\nrun()\n\`\`\``)).toBe(
            `#release für @Jana_Becker ${image} run()`
        )
    })

    test('copes with empty input', () => {
        expect(stripMarkdownForPreview(undefined)).toBe('')
        expect(stripMarkdownForPreview('')).toBe('')
    })
})
