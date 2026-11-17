import 'leaflet/dist/leaflet.css';
import L from 'leaflet';

export { L };

const OSM_ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

/**
 * Standard OpenStreetMap tiles (free, no key), darkened with a CSS filter on the base pane
 * so radar and markers keep their real colours.
 */
export function addDarkBasemap(map: L.Map) {
  map.createPane('basemap');
  const pane = map.getPane('basemap')!;
  pane.style.zIndex = '150';
  pane.classList.add('dark-basemap');
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: OSM_ATTRIBUTION,
    maxZoom: 19,
    pane: 'basemap',
  }).addTo(map);

  // Pane for markers and track outlines, above the radar overlay.
  map.createPane('labels');
  const labels = map.getPane('labels')!;
  labels.style.zIndex = '650';
}
