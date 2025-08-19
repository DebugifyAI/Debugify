const multer = require('multer');
const multerS3 = require('multer-s3');
const aws = require('aws-sdk');

// Configure AWS S3
const s3 = new aws.S3({
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  region: process.env.AWS_REGION || 'us-east-1'
});

// Configure multer for S3 storage
const upload = multer({
  storage: multerS3({
    s3: s3,
    bucket: process.env.AWS_S3_BUCKET_NAME || 'debugify-bucket',
    metadata: function (req, file, cb) {
      cb(null, { fieldName: file.fieldname });
    },
    key: function (req, file, cb) {
      // Generate unique file name with timestamp
      const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
      cb(null, 'bug-reports/' + file.fieldname + '-' + uniqueSuffix + '-' + file.originalname);
    }
  }),
  limits: {
    fileSize: 10 * 1024 * 1024 // 10MB limit
  },
  fileFilter: (req, file, cb) => {
    // Accept common image and log file types
    if (
      file.mimetype === 'image/jpeg' ||
      file.mimetype === 'image/png' ||
      file.mimetype === 'image/gif' ||
      file.mimetype === 'text/plain' ||
      file.mimetype === 'application/pdf' ||
      file.mimetype.startsWith('text/')
    ) {
      cb(null, true);
    } else {
      cb(new Error('Unsupported file type'));
    }
  }
});

module.exports = upload;
