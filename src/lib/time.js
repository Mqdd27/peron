// Departure maths in Asia/Jakarta, independent of the device's timezone.

const fmt = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Jakarta', weekday: 'short', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
})

/** {minutes since 00:00, weekend} for `date` in Jakarta. Before 04:00 counts as the previous service day. */
export function jakartaNow(date = new Date()) {
  const p = Object.fromEntries(fmt.formatToParts(date).map((x) => [x.type, x.value]))
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
  let day = days.indexOf(p.weekday)
  let minutes = +p.hour * 60 + +p.minute + +p.second / 60
  if (minutes < 240) (minutes += 1440), (day = (day + 6) % 7)
  // ponytail: Sat/Sun only; public holidays (which run the weekend timetable) need a holiday list.
  return { minutes, weekend: day === 0 || day === 6 }
}

const toMin = (t) => {
  const m = +t.slice(0, 2) * 60 + +t.slice(3, 5)
  return m < 240 ? m + 1440 : m
}

/** Next `n` departures: [{time: "HH:MM", inMin}] from a {weekday, weekend} timetable. */
export function nextDepartures(table, date = new Date(), n = 3) {
  const now = jakartaNow(date)
  const list = (now.weekend ? table?.weekend : table?.weekday)?.length ? (now.weekend ? table.weekend : table.weekday) : (table?.weekday ?? [])
  return list
    .map((time) => ({ time, inMin: Math.ceil(toMin(time) - now.minutes) }))
    .filter((d) => d.inMin >= 0)
    .slice(0, n)
}
