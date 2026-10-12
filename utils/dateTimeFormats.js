export const DATE_FORMAT_EUROPE = 'DD.MM.YYYY'
export const DATE_FORMAT_AMERICA = 'MM.DD.YYYY'

export const TIME_FORMAT_EUROPE = 'HH:mm'
export const TIME_FORMAT_AMERICA = 'hh:mm a'
export const TIME_FORMAT_EUROPE_S = 'HH:mm:ss'
export const TIME_FORMAT_AMERICA_S = 'hh:mm:ss a'

export const getTimeFormatForDateFormat = (dateFormat, showSeconds = false) =>
    (dateFormat || DATE_FORMAT_EUROPE) === DATE_FORMAT_EUROPE
        ? showSeconds
            ? TIME_FORMAT_EUROPE_S
            : TIME_FORMAT_EUROPE
        : showSeconds
          ? TIME_FORMAT_AMERICA_S
          : TIME_FORMAT_AMERICA
