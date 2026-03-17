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
    test('exposes Gmail search, attachment, and draft tools when allowed', () => {
        const schemas = getToolSchemas([
            'search_gmail',
            'get_gmail_attachment',
            'create_gmail_reply_draft',
            'create_gmail_draft',
            'update_gmail_draft',
        ])

        expect(schemas.map(schema => schema.function.name)).toEqual([
            'search_gmail',
            'get_gmail_attachment',
            'create_gmail_reply_draft',
            'create_gmail_draft',
            'update_gmail_draft',
        ])
    })

    test('defines required fields for new Gmail drafts', () => {
        expect(toolSchemas.create_gmail_draft.function.parameters.required).toEqual(['to', 'subject', 'body'])
        expect(toolSchemas.create_gmail_reply_draft.function.parameters.required).toEqual([])
        expect(toolSchemas.update_gmail_draft.function.parameters.required).toEqual(['draftId'])
    })

    test('defines required fields for Gmail attachment fetch', () => {
        expect(toolSchemas.get_gmail_attachment.function.parameters.required).toEqual(['messageId', 'attachmentId'])
        expect(toolSchemas.get_chat_attachment.function.parameters.required).toEqual([])
    })
})

describe('User memory assistant tool schemas', () => {
    test('exposes update_user_memory only when allowed', () => {
        expect(getToolSchemas(['update_user_memory']).map(schema => schema.function.name)).toEqual([
            'update_user_memory',
        ])
        expect(getToolSchemas(['create_task']).map(schema => schema.function.name)).toEqual(['create_task'])
    })

    test('defines required fields for update_user_memory', () => {
        expect(toolSchemas.update_user_memory.function.parameters.required).toEqual(['fact'])
        expect(toolSchemas.update_user_memory.function.parameters.properties.category.type).toBe('string')
        expect(toolSchemas.update_user_memory.function.parameters.properties.reason.type).toBe('string')
    })
})
