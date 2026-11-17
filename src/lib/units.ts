/** Unit conversion and formatting. Data is always stored metric. */

export type UnitSystem = 'metric' | 'imperial';
export type Quantity = 'temp' | 'speed' | 'precip' | 'percent';

export function formatValue(q: Quantity, value: number, system: UnitSystem): string {
  switch (q) {
    case 'temp':
      return system === 'metric' ? `${Math.round(value)} °C` : `${Math.round((value * 9) / 5 + 32)} °F`;
    case 'speed':
      return system === 'metric' ? `${Math.round(value)} km/h` : `${Math.round(value / 1.609344)} mph`;
    case 'precip':
      return system === 'metric'
        ? `${value.toFixed(1)} mm`
        : `${(value / 25.4).toFixed(value > 0 && value < 2.54 ? 2 : 1)} in`;
    case 'percent':
      return `${Math.round(value)}%`;
  }
}

/** Bare number in the given system, for chart axes. */
export function convert(q: Quantity, value: number, system: UnitSystem): number {
  if (system === 'metric') return value;
  if (q === 'temp') return (value * 9) / 5 + 32;
  if (q === 'speed') return value / 1.609344;
  if (q === 'precip') return value / 25.4;
  return value;
}
