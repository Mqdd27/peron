// Single source of truth for selection; map, panel and SVG all read/write this.
export const sel = $state({ station: null, exit: null })

export function select(station, exit = null) {
  sel.station = station
  sel.exit = exit
}
