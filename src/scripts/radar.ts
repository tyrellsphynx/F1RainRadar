/**
 * Live RainViewer radar loop. Only initialised when the race weekend window is active
 * (or when the URL contains ?radar, handy for testing outside race weekends).
 *
 * RainViewer free tier: past 2 h in 10-minute frames, max zoom 7, 100 requests/IP/minute,
 * so we use 512px tiles (a quarter of the requests) and load frames lazily.
 */
import { formatTime } from '../lib/format.ts';

const API = 'https://api.rainviewer.com/public/weather-maps.json';
const COLOR_SCHEME = 2; // Universal Blue, the only scheme on the free tier
const OPTIONS = '1_1'; // smoothed, snow shown in separate colours
const FRAME_MS = 600;
const LAST_FRAME_HOLD_MS = 1800;
const REFRESH_MS = 5 * 60_000;
const OUTLINE_MIN_ZOOM = 10;

interface Frame {
  time: number;
  path: string;
}

async function fetchFrames(): Promise<{ host: string; frames: Frame[] }> {
  const res = await fetch(API);
  if (!res.ok) throw new Error(`RainViewer ${res.status}`);
  const json = (await res.json()) as { host: string; radar?: { past?: Frame[] } };
  const frames = json.radar?.past ?? [];
  if (!frames.length) throw new Error('No radar frames');
  return { host: json.host, frames };
}

async function init(root: HTMLElement) {
  const { L, addDarkBasemap } = await import('./leaflet.ts');
  const lat = Number(root.dataset.lat);
  const lon = Number(root.dataset.lon);
  const mapEl = root.querySelector<HTMLElement>('[data-radar-map]')!;
  const errorEl = root.querySelector<HTMLElement>('[data-radar-error]')!;
  const playBtn = root.querySelector<HTMLButtonElement>('[data-radar-play]')!;
  const slider = root.querySelector<HTMLInputElement>('[data-radar-slider]')!;
  const timeEl = root.querySelector<HTMLElement>('[data-radar-time]')!;
  const outline = JSON.parse(root.querySelector('[data-radar-outline]')?.textContent || 'null') as
    | [number, number][]
    | null;

  const map = L.map(mapEl, { minZoom: 3, maxZoom: 13, zoomSnap: 0.5 }).setView([lat, lon], 7);
  addDarkBasemap(map);

  const marker = L.circleMarker([lat, lon], {
    radius: 6,
    color: '#fff',
    weight: 2,
    fillColor: '#e10600',
    fillOpacity: 1,
    pane: 'labels',
  }).addTo(map);
  const track = outline
    ? L.polyline(outline, { color: '#e10600', weight: 3, opacity: 0.95, pane: 'labels' })
    : null;
  const updateOutline = () => {
    const showTrack = track && map.getZoom() >= OUTLINE_MIN_ZOOM;
    if (showTrack) {
      track.addTo(map);
      marker.remove();
    } else {
      track?.remove();
      marker.addTo(map);
    }
  };
  map.on('zoomend', updateOutline);
  updateOutline();

  let host = '';
  let frames: Frame[] = [];
  const layers = new Map<number, L.TileLayer>();
  let current = -1;
  let timer: number | undefined;

  const layerFor = (i: number) => {
    const frame = frames[i]!;
    let layer = layers.get(frame.time);
    if (!layer) {
      layer = L.tileLayer(`${host}${frame.path}/512/{z}/{x}/{y}/${COLOR_SCHEME}/${OPTIONS}.png`, {
        tileSize: 512,
        zoomOffset: -1,
        maxNativeZoom: 8, // 8 + zoomOffset -1 = RainViewer zoom 7
        maxZoom: 13,
        opacity: 0,
        attribution: 'Radar: <a href="https://www.rainviewer.com/">RainViewer</a>',
      });
      layer.on('tileerror', () => (errorEl.hidden = false));
      layers.set(frame.time, layer);
      layer.addTo(map);
    }
    return layer;
  };

  const show = (i: number) => {
    if (!frames.length) return;
    const next = (i + frames.length) % frames.length;
    if (current >= 0 && frames[current]) layerFor(current).setOpacity(0);
    layerFor(next).setOpacity(0.75);
    // Preload the following frame so playback is smooth.
    if (frames[next + 1]) layerFor(next + 1);
    current = next;
    slider.value = String(next);
    const t = frames[next]!.time * 1000;
    const ago = Math.round((Date.now() - t) / 60_000);
    timeEl.textContent = `${formatTime(t, 'time')} (${ago} min ago)`;
  };

  const stop = () => {
    clearTimeout(timer);
    timer = undefined;
    playBtn.textContent = '▶';
    playBtn.setAttribute('aria-label', 'Play radar animation');
  };
  const step = () => {
    show(current + 1);
    timer = window.setTimeout(step, current === frames.length - 1 ? LAST_FRAME_HOLD_MS : FRAME_MS);
  };
  const play = () => {
    playBtn.textContent = '❚❚';
    playBtn.setAttribute('aria-label', 'Pause radar animation');
    step();
  };

  playBtn.addEventListener('click', () => (timer ? stop() : play()));
  slider.addEventListener('input', () => {
    stop();
    show(Number(slider.value));
  });

  const load = async () => {
    try {
      const data = await fetchFrames();
      const latest = data.frames.at(-1)!.time;
      if (frames.at(-1)?.time === latest) return;
      // Drop layers for frames that rolled out of the 2-hour window.
      const keep = new Set(data.frames.map((f) => f.time));
      for (const [time, layer] of layers) {
        layer.setOpacity(0);
        if (!keep.has(time)) {
          layer.remove();
          layers.delete(time);
        }
      }
      host = data.host;
      frames = data.frames;
      slider.max = String(frames.length - 1);
      errorEl.hidden = true;
      current = -1;
      show(frames.length - 1);
    } catch (err) {
      console.error(err);
      errorEl.hidden = false;
    }
  };

  await load();
  setInterval(load, REFRESH_MS);
}

function setup() {
  const force = new URLSearchParams(location.search).has('radar');
  for (const root of document.querySelectorAll<HTMLElement>('[data-radar]')) {
    if (root.dataset.radarReady) continue;
    const now = Date.now();
    const active = force || (now >= Number(root.dataset.windowStart) && now < Number(root.dataset.windowEnd));
    root.querySelector<HTMLElement>('.radar-active')!.hidden = !active;
    root.querySelector<HTMLElement>('.radar-pending')!.hidden = active;
    if (active) {
      root.dataset.radarReady = '1';
      init(root).catch((err) => {
        console.error(err);
        root.querySelector<HTMLElement>('[data-radar-error]')!.hidden = false;
      });
    }
  }
}

setup();
// Switch the radar on without a reload when the weekend window opens while the page is open.
setInterval(setup, 60_000);
