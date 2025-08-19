// // Simple test script for security validation without full environment setup
// process.env.NODE_ENV = 'development';
// process.env.CREDENTIAL_ENCRYPTION_KEY = 'test-key-for-development-only';

// const { validateFilename } = require('./middleware/uploadSecurityValidation');

// console.log('Testing Security Validation...\n');

// // Test safe filenames
// const safeFilenames = [
//   'document.pdf',
//   'image_001.jpg',
//   'data-file.csv',
//   'report.2024.txt',
// ];

// console.log('Testing safe filenames:');
// safeFilenames.forEach(filename => {
//   const result = validateFilename(filename);
//   console.log(`  ${filename}: ${result.isValid ? 'PASS' : 'FAIL'}`);
//   if (!result.isValid) {
//     console.log(`    Errors: ${result.errors.join(', ')}`);
//   }
// });

// console.log('\nTesting dangerous filenames:');
// const dangerousFilenames = [
//   '../../../etc/passwd',
//   'file\x00.jpg',
//   'CON.jpg',
//   'malicious.exe',
//   '  spaced.jpg  ',
//   'файл.jpg', // Cyrillic
//   '\u202efile.jpg', // Unicode direction override
// ];

// dangerousFilenames.forEach(filename => {
//   const result = validateFilename(filename);
//   console.log(`  ${filename}: ${result.isValid ? 'FAIL (should be rejected)' : 'PASS (correctly rejected)'}`);
//   if (!result.isValid) {
//     console.log(`    Errors: ${result.errors.join(', ')}`);
//   }
// });

// console.log('\n✅ Security validation tests completed!');