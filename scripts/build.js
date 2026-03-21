#!/usr/bin/env node
/**
 * Build script for MD Viewer - packs sources into macOS app.
 * Run: npm run build
 * Output: dist/
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');

// Build icon if source exists
const iconSrc = path.join(root, 'assets', 'mdviewer-icon.png');
if (fs.existsSync(iconSrc)) {
  try {
    execSync('node scripts/build-icon.js', { cwd: root, stdio: 'pipe' });
  } catch (_) {}
}

// Ensure dist exists
const distDir = path.join(root, 'dist');
if (!fs.existsSync(distDir)) fs.mkdirSync(distDir, { recursive: true });

// Run electron-builder
console.log('Building MD Viewer for macOS...');
execSync('npx electron-builder --mac --publish never', {
  cwd: root,
  stdio: 'inherit',
});

console.log('Done. Artifacts in dist/');
