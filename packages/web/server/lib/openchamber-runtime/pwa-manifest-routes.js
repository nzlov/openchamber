const DEFAULT_PWA_APP_NAME = 'OpenChamber - AI Coding Assistant';
const mapPwaOrientationToManifest = (value) => {
  if (value === 'portrait') {
    return 'portrait-primary';
  }
  if (value === 'landscape') {
    return 'landscape-primary';
  }
  return undefined;
};

export const registerPwaManifestRoute = (app, dependencies) => {
  const {
    readSettingsFromDiskMigrated,
    normalizePwaAppName,
    normalizePwaOrientation,
  } = dependencies;

  app.get('/manifest.webmanifest', async (req, res) => {
    const hasQueryOverride =
      typeof req.query?.pwa_name === 'string'
      || typeof req.query?.app_name === 'string'
      || typeof req.query?.appName === 'string';

    let queryValueRaw = '';
    if (typeof req.query?.pwa_name === 'string') {
      queryValueRaw = req.query.pwa_name;
    } else if (typeof req.query?.app_name === 'string') {
      queryValueRaw = req.query.app_name;
    } else if (typeof req.query?.appName === 'string') {
      queryValueRaw = req.query.appName;
    }

    const queryOverrideName = normalizePwaAppName(queryValueRaw, '');
    const hasOrientationOverride = typeof req.query?.orientation === 'string';
    const queryOverrideOrientation = normalizePwaOrientation(req.query?.orientation, 'system');

    let storedName = '';
    let storedOrientation = 'system';
    try {
      const settings = await readSettingsFromDiskMigrated();
      storedName = normalizePwaAppName(settings?.pwaAppName, '');
      storedOrientation = normalizePwaOrientation(settings?.pwaOrientation, 'system');
    } catch {
      storedName = '';
      storedOrientation = 'system';
    }

    const appName = hasQueryOverride
      ? (queryOverrideName || DEFAULT_PWA_APP_NAME)
      : (storedName || DEFAULT_PWA_APP_NAME);
    const manifestOrientation = mapPwaOrientationToManifest(
      hasOrientationOverride ? queryOverrideOrientation : storedOrientation
    );

    const shortName = appName.length > 30 ? appName.slice(0, 30) : appName;
    const manifest = {
      name: appName,
      short_name: shortName,
      description: 'Web interface companion for Codex AI coding agent',
      id: '/',
      start_url: '/',
      scope: '/',
      display: 'standalone',
      display_override: ['window-controls-overlay'],
      background_color: '#151313',
      theme_color: '#edb449',
      ...(manifestOrientation ? { orientation: manifestOrientation } : {}),
      icons: [
        { src: '/pwa-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
        { src: '/pwa-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
        { src: '/pwa-maskable-192.png', sizes: '192x192', type: 'image/png', purpose: 'any maskable' },
        { src: '/pwa-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
        { src: '/apple-touch-icon-180x180.png', sizes: '180x180', type: 'image/png', purpose: 'any' },
        { src: '/apple-touch-icon-152x152.png', sizes: '152x152', type: 'image/png', purpose: 'any' },
        { src: '/favicon-32.png', sizes: '32x32', type: 'image/png' },
        { src: '/favicon-16.png', sizes: '16x16', type: 'image/png' },
      ],
      shortcuts: [
        {
          name: 'Appearance Settings',
          short_name: 'Settings',
          description: 'Open appearance settings',
          url: '/?settings=appearance',
          icons: [{ src: '/pwa-192.png', sizes: '192x192', type: 'image/png' }],
        },
      ],
      categories: ['developer', 'tools', 'productivity'],
      lang: 'en',
    };

    res.setHeader('Cache-Control', 'no-store, must-revalidate');
    res.type('application/manifest+json');
    res.send(JSON.stringify(manifest));
  });
};
