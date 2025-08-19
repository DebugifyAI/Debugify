const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

async function createTestImages() {
  const fixturesDir = __dirname;

  // Create a simple test image
  const testImage = await sharp({
    create: {
      width: 800,
      height: 600,
      channels: 3,
      background: { r: 255, g: 128, b: 0 }
    }
  })
  .jpeg({ quality: 90 })
  .toBuffer();

  fs.writeFileSync(path.join(fixturesDir, 'test-image.jpg'), testImage);

  // Create a high-resolution test image
  const highResImage = await sharp({
    create: {
      width: 3840,
      height: 2160,
      channels: 3,
      background: { r: 0, g: 255, b: 0 }
    }
  })
  .jpeg({ quality: 95 })
  .toBuffer();

  fs.writeFileSync(path.join(fixturesDir, 'high-res-image.jpg'), highResImage);

  // Create a PNG with transparency
  const pngImage = await sharp({
    create: {
      width: 400,
      height: 300,
      channels: 4,
      background: { r: 255, g: 255, b: 255, alpha: 0.5 }
    }
  })
  .png()
  .toBuffer();

  fs.writeFileSync(path.join(fixturesDir, 'transparent-image.png'), pngImage);

  console.log('Test images created successfully');
}

if (require.main === module) {
  createTestImages().catch(console.error);
}

module.exports = { createTestImages };