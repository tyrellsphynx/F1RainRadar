/**
 * Unit preference (metric/imperial), persisted in localStorage.
 * Renders every [data-u] element and notifies client-rendered charts via a "unitschange" event.
 */
import { type Quantity, type UnitSystem, convert, formatValue } from '../lib/units.ts';

const STORAGE_KEY = 'units';

export function getUnits(): UnitSystem {
  return localStorage.getItem(STORAGE_KEY) === 'imperial' ? 'imperial' : 'metric';
}

const UNIT_LABELS: Record<Quantity, Record<UnitSystem, string>> = {
  temp: { metric: '°C', imperial: '°F' },
  speed: { metric: 'km/h', imperial: 'mph' },
  precip: { metric: 'mm', imperial: 'in' },
  percent: { metric: '%', imperial: '%' },
};

export const unitLabel = (q: Quantity, system = getUnits()) => UNIT_LABELS[q][system];

export function renderUnits(root: ParentNode = document) {
  const system = getUnits();
  for (const el of root.querySelectorAll<HTMLElement | SVGElement>('[data-u]')) {
    const q = el.dataset.u as Quantity;
    const v = Number(el.dataset.v);
    if ('axis' in el.dataset) {
      // Axis ticks: bare number with a short suffix.
      const n = convert(q, v, system);
      el.textContent = `${q === 'precip' && system === 'imperial' ? n.toFixed(2) : Math.round(n)}${q === 'temp' ? '°' : ''}`;
    } else {
      el.textContent = formatValue(q, v, system);
    }
  }
  for (const el of root.querySelectorAll<HTMLElement | SVGElement>('[data-unit-label]')) {
    el.textContent = unitLabel(el.dataset.unitLabel as Quantity, system);
  }
  for (const btn of document.querySelectorAll<HTMLElement>('[data-units-toggle]')) {
    btn.textContent = system === 'metric' ? '°C · km/h' : '°F · mph';
    btn.title = 'Switch between metric and imperial units';
  }
}

document.addEventListener('click', (e) => {
  if (!(e.target as HTMLElement).closest('[data-units-toggle]')) return;
  localStorage.setItem(STORAGE_KEY, getUnits() === 'metric' ? 'imperial' : 'metric');
  renderUnits();
  document.dispatchEvent(new CustomEvent('unitschange'));
});

renderUnits();
