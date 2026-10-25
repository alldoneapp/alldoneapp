import de from './translations/de.json'
import en from './translations/en.json'
import es from './translations/es.json'

import {
    OKR_CADENCE_DAILY,
    OKR_CADENCE_MONTHLY,
    OKR_CADENCE_QUARTERLY,
    OKR_CADENCE_WEEKLY,
    OKR_TYPE_MANUAL,
    OKR_TYPE_TIME_LOGGED_REVENUE,
} from '../components/TaskListView/OKRs/okrHelper'

const locales = { de, en, es }

/**
 * A handful of call sites build their locale key at runtime — translate(`OKR cadence ${x}`).
 * That is deliberate and correct: the alternative, interpolating a noun into one generic
 * sentence, produces wrong grammar in German and Spanish (gender agreement, word order) and
 * would flatten presentational special cases such as "60 minute duration" rendering as
 * "1 hour" rather than "60 min".
 *
 * The cost of the pattern is that no static check can see the keys, so a variant can go
 * missing unnoticed — several had (AT-2522). This test is the missing check: it enumerates
 * every value each call site can interpolate and asserts the resulting key resolves in all
 * three shipped locales. When you add a new enum member, add it here too.
 */
const DYNAMIC_KEY_SITES = [
    {
        // components/MeetingBooking/MeetingBookingPage.js, PublicBookingSettings.js
        // Bounded by ALLOWED_BOOKING_DURATIONS in functions/Booking/bookingSettings.js.
        site: '`${duration} minute duration`',
        keys: [15, 30, 60].map(duration => `${duration} minute duration`),
    },
    {
        // ConnectCalendarModal/ConnectedUserData.js, ConnectGmailModal/ConnectedUserData.js
        site: "`${isConnected ? 'Connected' : 'Connect'} to Email`",
        keys: ['Connected to Email', 'Connect to Email'],
    },
    {
        // components/UIComponents/FloatModals/DescriptionModal/DescriptionModal.js
        site: '`${type} description`',
        keys: ['Task', 'Goal', 'Workstream', 'Skill', 'Assistant'].map(type => `${type} description`),
    },
    {
        // components/UIComponents/FloatModals/ConnectionStateModal.js
        site: "`Alldone is ${isOnline ? 'online' : 'offline'}`",
        keys: ['Alldone is online', 'Alldone is offline'],
    },
    {
        // components/UIComponents/FloatModals/DescriptionModal/DescriptionModal.js
        site: '`Here you can enter in details what this ${type} is about`',
        keys: ['task', 'goal', 'workstream', 'skill', 'assistant'].map(
            type => `Here you can enter in details what this ${type} is about`
        ),
    },
    {
        // components/TaskDetailedView/Properties/DescriptionField.js
        site: '`Type the ${type} description here`',
        keys: ['task', 'goal', 'project', 'skill', 'assistant'].map(type => `Type the ${type} description here`),
    },
    {
        // components/Tags/TaskSummation.js, utils/EstimationHelper.js
        // Every `text` getEstimationTypeResume can return, for both estimation types.
        site: '`Initial of ${estimationResume.text}`',
        keys: ['Point', 'Points', 'Minutes', 'Hour', 'Hours', 'Day', 'Days', 'Month', 'Months', 'Year', 'Years'].map(
            unit => `Initial of ${unit}`
        ),
    },
    {
        // components/Workstreams/ProjectWStreamHeader.js
        site: "`Number Stream${number > 1 ? 's' : ''}`",
        keys: ['Number Stream', 'Number Streams'],
    },
    {
        // components/UIControls/StickyButton.js
        site: "`Sticky amount ${days > 1 ? 'days' : 'day'}`",
        keys: ['Sticky amount day', 'Sticky amount days'],
    },
    {
        // components/TaskListView/OKRs/OKRModal.js, OKRItem.js, ProjectOKRs/OKRHistoryRow.js
        site: '`OKR cadence ${cadence}`',
        keys: [OKR_CADENCE_DAILY, OKR_CADENCE_WEEKLY, OKR_CADENCE_MONTHLY, OKR_CADENCE_QUARTERLY].map(
            cadence => `OKR cadence ${cadence}`
        ),
    },
    {
        // components/TaskListView/OKRs/OKRModal.js
        site: '`OKR type ${type}`',
        keys: [OKR_TYPE_MANUAL, OKR_TYPE_TIME_LOGGED_REVENUE].map(type => `OKR type ${type}`),
    },
]

describe('dynamically built translation keys (AT-2522)', () => {
    describe.each(DYNAMIC_KEY_SITES)('$site', ({ keys }) => {
        it.each(Object.entries(locales))('resolves every variant in %s', (localeName, translations) => {
            const missing = keys.filter(key => translations[key] === undefined)

            expect(missing).toEqual([])
        })
    })

    it('keeps the presentational special cases that rule out a generic interpolation', () => {
        // Refactoring `${duration} minute duration` to a single "%{duration} min" key would
        // silently turn "1 hour" into "60 min" in all three locales.
        expect(en['60 minute duration']).toBe('1 hour')
        expect(de['60 minute duration']).toBe('1 Stunde')
        expect(es['60 minute duration']).toBe('1 hora')
    })

    it('covers every estimation unit getEstimationTypeResume can produce', () => {
        // Read the ladder out of the source rather than importing EstimationHelper, which
        // pulls in the redux store. This is what catches a unit being added to the ladder
        // without a matching "Initial of …" key.
        const fs = require('fs')
        const path = require('path')
        const source = fs.readFileSync(path.join(__dirname, '..', 'utils', 'EstimationHelper.js'), 'utf8')
        const resume = source.slice(
            source.indexOf('export const getEstimationTypeResume'),
            source.indexOf('export const convertMinutesInHours')
        )

        expect(resume).toBeTruthy()

        // Every single-quoted literal in that function is a unit name, including the ones
        // produced by a ternary (`text: estimation <= 1 ? 'Point' : 'Points'`).
        const units = [...new Set([...resume.matchAll(/'([^']+)'/g)].map(match => match[1]))]
        const covered = DYNAMIC_KEY_SITES.find(entry => entry.site.includes('Initial of')).keys

        // Sanity-check the extraction itself, so a refactor that stops matching cannot make
        // this assertion pass vacuously against an empty list.
        expect(units).toEqual(expect.arrayContaining(['Point', 'Points', 'Minutes', 'Hours', 'Years']))
        units.forEach(unit => expect(covered).toContain(`Initial of ${unit}`))
    })
})
