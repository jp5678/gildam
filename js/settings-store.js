// 설정: localStorage 에 JSON 으로 저장. 항상 새 객체를 반환(불변).

const KEY = 'gildam.settings.v1';

export const DEFAULT_SETTINGS = Object.freeze({
  maptilerKey: '',
  weightKg: 65,
  theme: 'system', // system | light | dark
  defaultType: 'run',
  maxAccuracy: 30,
  homeHide: Object.freeze({ enabled: false, lat: null, lon: null, radius: 300 }),
});

function sanitize(raw) {
  const s = raw && typeof raw === 'object' ? raw : {};
  const weight = Number(s.weightKg);
  const home = s.homeHide && typeof s.homeHide === 'object' ? s.homeHide : {};
  return {
    maptilerKey: typeof s.maptilerKey === 'string' ? s.maptilerKey.trim().slice(0, 100) : '',
    weightKg: Number.isFinite(weight) && weight >= 20 && weight <= 250 ? weight : DEFAULT_SETTINGS.weightKg,
    theme: ['system', 'light', 'dark'].includes(s.theme) ? s.theme : 'system',
    defaultType: ['walk', 'run', 'bike', 'hike'].includes(s.defaultType) ? s.defaultType : DEFAULT_SETTINGS.defaultType,
    maxAccuracy: DEFAULT_SETTINGS.maxAccuracy,
    homeHide: {
      enabled: Boolean(home.enabled),
      lat: Number.isFinite(home.lat) ? home.lat : null,
      lon: Number.isFinite(home.lon) ? home.lon : null,
      radius: Number.isFinite(home.radius) ? Math.min(2000, Math.max(100, home.radius)) : 300,
    },
  };
}

export function loadSettings() {
  try {
    return sanitize(JSON.parse(localStorage.getItem(KEY) ?? '{}'));
  } catch {
    return sanitize({});
  }
}

/** 변경분을 병합해 저장하고 새 설정 객체를 반환 */
export function saveSettings(patch) {
  const next = sanitize({ ...loadSettings(), ...patch });
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch (err) {
    throw new Error(`설정을 저장하지 못했습니다: ${err instanceof Error ? err.message : err}`);
  }
  return next;
}

export function applyTheme(theme = loadSettings().theme) {
  document.documentElement.dataset.theme = theme;
}
