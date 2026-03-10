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
