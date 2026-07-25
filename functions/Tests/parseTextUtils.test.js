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
