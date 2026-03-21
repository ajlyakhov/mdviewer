#!/usr/bin/env node
/**
 * Build app icon .icns from SVG, WebP, or PNG source.
 * Priority: mdviewer-icon.webp > icon.svg > mdviewer-icon.png
 * Requires: macOS (sips, iconutil), sharp (npm)
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const svgSrc = path.join(root, 'assets', 'icon.svg');
const webpSrc = path.join(root, 'assets', 'mdviewer-icon.webp');
const pngSrc = path.join(root, 'assets', 'mdviewer-icon.png');
const iconset = path.join(root, 'assets', 'icon.iconset');
const square = path.join(root, 'assets', '.icon-square.png');

fs.mkdirSync(path.join(root, 'assets'), { recursive: true });

if (fs.existsSync(webpSrc)) {
  const sharp = require('sharp');
  sharp(webpSrc)
    .resize(1024, 1024)
    .png()
    .toFile(square)
    .then(() => {
      console.log('Converted mdviewer-icon.webp to 1024x1024');
      buildIcons();
    })
    .catch((err) => {
      console.error('Sharp failed:', err.message);
      process.exit(1);
    });
} else if (fs.existsSync(svgSrc)) {
  const sharp = require('sharp');
  sharp(fs.readFileSync(svgSrc))
    .resize(1024, 1024)
    .png()
    .toFile(square)
    .then(() => {
      console.log('Rendered icon.svg to 1024x1024');
      buildIcons();
    })
    .catch((err) => {
      console.error('Sharp failed:', err.message);
      process.exit(1);
    });
} else if (fs.existsSync(pngSrc)) {
  try {
    execSync(`sips --cropToHeightWidth 1024 1024 "${pngSrc}" --out "${square}"`);
  } catch {
    execSync(`sips -z 1024 1024 "${pngSrc}" --out "${square}"`);
  }
  buildIcons();
} else {
  console.error('No source found. Add assets/icon.svg, assets/mdviewer-icon.webp, or assets/mdviewer-icon.png');
  process.exit(1);
}

function buildIcons() {
  if (!fs.existsSync(square)) return;

  fs.mkdirSync(iconset, { recursive: true });

  const sizes = [
    [16, 'icon_16x16.png'],
    [32, 'icon_16x16@2x.png'],
    [32, 'icon_32x32.png'],
    [64, 'icon_32x32@2x.png'],
    [128, 'icon_128x128.png'],
    [256, 'icon_128x128@2x.png'],
    [256, 'icon_256x256.png'],
    [512, 'icon_256x256@2x.png'],
    [512, 'icon_512x512.png'],
    [1024, 'icon_512x512@2x.png'],
  ];

  for (const [size, name] of sizes) {
    const out = path.join(iconset, name);
    execSync(`sips -z ${size} ${size} "${square}" --out "${out}"`);
  }

  execSync(`iconutil -c icns "${iconset}" -o "${path.join(root, 'assets', 'icon.icns')}"`);
  if (fs.existsSync(square)) fs.unlinkSync(square);
  console.log('Created assets/icon.icns');
}
