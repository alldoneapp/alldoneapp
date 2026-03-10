const { getToolSchemas, toolSchemas } = require('./toolSchemas')

describe('Calendar assistant tool schemas', () => {
    test('exposes all calendar tool schemas when allowed', () => {
        const schemas = getToolSchemas([
            'search_calendar_events',
            'create_calendar_event',
            'update_calendar_event',
            'delete_calendar_event',
        ])

        expect(schemas.map(schema => schema.function.name)).toEqual([
            'search_calendar_events',
            'create_calendar_event',
            'update_calendar_event',
            'delete_calendar_event',
        ])
    })

    test('defines required fields for calendar event writes', () => {
        expect(toolSchemas.create_calendar_event.function.parameters.required).toEqual(['summary', 'start', 'end'])
        expect(toolSchemas.update_calendar_event.function.parameters.required).toEqual(['eventId'])
        expect(toolSchemas.delete_calendar_event.function.parameters.required).toEqual(['eventId'])
    })
})

describe('Gmail assistant tool schemas', () => {
    test('exposes Gmail search and draft tools when allowed', () => {
        const schemas = getToolSchemas(['search_gmail', 'create_gmail_reply_draft', 'create_gmail_draft'])

        expect(schemas.map(schema => schema.function.name)).toEqual([
            'search_gmail',
            'create_gmail_reply_draft',
            'create_gmail_draft',
        ])
    })

    test('defines required fields for new Gmail drafts', () => {
        expect(toolSchemas.create_gmail_draft.function.parameters.required).toEqual(['to', 'subject', 'body'])
        expect(toolSchemas.create_gmail_reply_draft.function.parameters.required).toEqual([])
    })
})
