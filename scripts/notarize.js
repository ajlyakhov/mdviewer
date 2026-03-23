/**
 * macOS notarization hook for electron-builder (afterSign).
 *
 * Required GitHub Actions secrets:
 *   APPLE_ID                   – your Apple ID email
 *   APPLE_APP_SPECIFIC_PASSWORD – app-specific password from appleid.apple.com
 *   APPLE_TEAM_ID              – 10-character Team ID from developer.apple.com
 *
 * If any of the three vars are absent the step is skipped (unsigned builds still work).
 */

const { notarize } = require('@electron/notarize');

exports.default = async function notarizing(context) {
  if (context.electronPlatformName !== 'darwin') return;

  const appleId = process.env.APPLE_ID;
  const appleIdPassword = process.env.APPLE_APP_SPECIFIC_PASSWORD;
  const teamId = process.env.APPLE_TEAM_ID;

  if (!appleId || !appleIdPassword || !teamId) {
    console.log('[notarize] Skipping: APPLE_ID / APPLE_APP_SPECIFIC_PASSWORD / APPLE_TEAM_ID not set.');
    return;
  }

  const appName = context.packager.appInfo.productFilename;
  const appPath = `${context.appOutDir}/${appName}.app`;

  console.log(`[notarize] Notarizing ${appPath} …`);
  await notarize({ tool: 'notarytool', appPath, appleId, appleIdPassword, teamId });
  console.log('[notarize] Done.');
};
