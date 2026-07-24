import React from 'react'
import ApiCalendar from '../../apis/google/calendar/ApiCalendar'

test('setCalendar method', () => {
    ApiCalendar.setCalendar('test-calendar')
    expect(ApiCalendar.calendar).toBe('test-calendar')
})
