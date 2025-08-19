const BugReport = require('../models/BugReport');
const Team = require('../models/Team');
const Artifact = require('../models/Artifact');
const { enqueueFileProcessingJob } = require('../queues/fileProcessingQueue');
const aws = require('aws-sdk');

exports.createWithUpload = async (req, res) => {
  try {
    const { teamId, title, description, source } = req.body;
    const files = req.files;

    if (!teamId || !title) {
      return res.status(400).json({ message: 'Team ID and title are required' });
    }

    // Check if user is a member of the team
    const teamMembers = await Team.getMembers(teamId);
    const isMember = teamMembers.some(member => member.user_id === req.user.id);
    
    if (!isMember) {
      return res.status(403).json({ message: 'You must be a member of the team to create bug reports' });
    }

    // Create bug report
    const bugReport = await BugReport.create({
      teamId,
      reportedBy: req.user.id,
      source: source || 'unknown',
      title,
      desc: description || '',
      status: 'open',
    });

    // Persist uploaded files as artifacts
    const artifacts = [];
    if (files && files.length > 0) {
      for (const file of files) {
        const artifact = await Artifact.createForBug({
          bugReportId: bugReport.id,
          uploaderUserId: req.user.id,
          s3Bucket: file.bucket || process.env.AWS_S3_BUCKET_NAME,
          s3Key: file.key,
          contentType: file.mimetype,
          sizeBytes: file.size,
          etag: file.etag || null,
          status: 'uploaded',
          metadata: {
            originalname: file.originalname,
            location: file.location,
          },
        });
        artifacts.push(artifact);
      }

      // Enqueue processing by artifact IDs
      const artifactIds = artifacts.map(a => a.id);
      const jobId = await enqueueFileProcessingJob(bugReport.id, artifactIds);
      console.log(`Enqueued file processing job ${jobId} for bug report ${bugReport.id}`);
    }

    res.status(201).json({
      message: 'Bug report created successfully',
      bugReport,
      artifacts,
    });
  } catch (error) {
    console.error('Error creating bug report:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

exports.listByTeam = async (req, res) => {
  try {
    const { teamId } = req.params;  
    // Check if user is a member of the team
    const teamMembers = await Team.getMembers(teamId);
    const isMember = teamMembers.some(member => member.user_id === req.user.id); 
    if (!isMember) {
      return res.status(403).json({ message: 'You must be a member of the team to view bug reports' });
    }

    const bugReports = await BugReport.listByTeam(teamId);
    res.json({
      bugReports,
    });
  } catch (error) {
    console.error('Error listing bug reports:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

exports.showBug = async (req, res) => {
  try {
    const { bugId } = req.params;
    // Fetch bug report
    const bugReport = await BugReport.find(bugId);
    if (!bugReport) {
      return res.status(404).json({ message: 'Bug report not found' });
    }

    // Check if user is a member of the team the bug belongs to
    const teamMembers = await Team.getMembers(bugReport.team_id);
    const isMember = teamMembers.some(member => member.user_id === req.user.id);
    if (!isMember) {
      return res.status(403).json({ message: 'You must be a member of the team to view this bug report' });
    }

    // List artifacts linked to this bug
    const attachments = await Artifact.findAll({ bug_report_id: bugId });
    res.json({
      bugReport,
      attachments,
    });
  } catch (error) {
    console.error('Error fetching bug report:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

// Helper: build a final S3 key for an artifact under a bug
const buildFinalS3Key = (bugId, originalName) => {
  const ts = Date.now();
  const rnd = Math.round(Math.random() * 1e9);
  return `bug-reports/${bugId}/artifacts/${ts}-${rnd}-${originalName}`;
};

// Client-direct upload: presign a PUT URL for S3
exports.presignUpload = async (req, res) => {
  try {
    const { bugId } = req.params;
    const { filename, contentType } = req.body || {};
    if (!filename || !contentType) {
      return res.status(400).json({ message: 'filename and contentType are required' });
    }

    const bugReport = await BugReport.find(bugId);
    if (!bugReport) return res.status(404).json({ message: 'Bug report not found' });

    // Authorization: user must be in the team
    const teamMembers = await Team.getMembers(bugReport.team_id);
    const isMember = teamMembers.some(m => m.user_id === req.user.id);
    if (!isMember) return res.status(403).json({ message: 'Forbidden' });

    const s3 = new aws.S3({
      accessKeyId: process.env.AWS_ACCESS_KEY_ID,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
      region: process.env.AWS_REGION || 'us-east-1',
    });

    const bucket = process.env.AWS_S3_BUCKET_NAME;
    const key = buildFinalS3Key(bugId, filename);

    const url = s3.getSignedUrl('putObject', {
      Bucket: bucket,
      Key: key,
      ContentType: contentType,
      Expires: 60, // seconds
      // ServerSideEncryption: 'AES256',
    });

    return res.json({ bucket, key, url, headers: { 'Content-Type': contentType } });
  } catch (error) {
    console.error('Error presigning upload:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
};

// Client-direct upload: confirm uploaded objects, create artifacts, enqueue processing
exports.confirmUploads = async (req, res) => {
  try {
    const { bugId } = req.params;
    const { uploads } = req.body || {}; // [{ bucket, key, contentType, sizeBytes, etag, originalName }]
    if (!Array.isArray(uploads) || uploads.length === 0) {
      return res.status(400).json({ message: 'uploads array required' });
    }

    const bugReport = await BugReport.find(bugId);
    if (!bugReport) return res.status(404).json({ message: 'Bug report not found' });

    // Authorization
    const teamMembers = await Team.getMembers(bugReport.team_id);
    const isMember = teamMembers.some(m => m.user_id === req.user.id);
    if (!isMember) return res.status(403).json({ message: 'Forbidden' });

    const artifacts = [];
    for (const u of uploads) {
      if (!u.bucket || !u.key) continue;
      const artifact = await Artifact.createForBug({
        bugReportId: Number(bugId),
        uploaderUserId: req.user.id,
        s3Bucket: u.bucket,
        s3Key: u.key,
        contentType: u.contentType || null,
        sizeBytes: u.sizeBytes || null,
        etag: u.etag || null,
        status: 'uploaded',
        metadata: { originalname: u.originalName || null },
      });
      artifacts.push(artifact);
    }

    const artifactIds = artifacts.map(a => a.id);
    const jobId = artifactIds.length > 0
      ? await enqueueFileProcessingJob(Number(bugId), artifactIds)
      : null;

    return res.json({ artifacts, jobId });
  } catch (error) {
    console.error('Error confirming uploads:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
};
// List artifacts for a bug report
exports.listArtifacts = async (req, res) => {
  try {
    const { bugId } = req.params;

    const bugReport = await BugReport.find(bugId);
    if (!bugReport) return res.status(404).json({ message: 'Bug report not found' });

    // Authorization: user must be on the team
    const teamMembers = await Team.getMembers(bugReport.team_id);
    const isMember = teamMembers.some(member => member.user_id === req.user.id);
    if (!isMember) return res.status(403).json({ message: 'Forbidden' });

    const artifacts = await Artifact.findAll({ bug_report_id: bugId });
    res.json({ artifacts });
  } catch (error) {
    console.error('Error listing artifacts:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

// Trigger processing for a bug's uploaded artifacts
exports.processArtifacts = async (req, res) => {
  try {
    const { bugId } = req.params;

    const bugReport = await BugReport.find(bugId);
    if (!bugReport) return res.status(404).json({ message: 'Bug report not found' });

    // Authorization
    const teamMembers = await Team.getMembers(bugReport.team_id);
    const isMember = teamMembers.some(member => member.user_id === req.user.id);
    if (!isMember) return res.status(403).json({ message: 'Forbidden' });

    const pending = await Artifact.findAll({ bug_report_id: bugId, status: 'uploaded' });
    if (pending.length === 0) return res.status(200).json({ message: 'No pending artifacts to process' });

    const artifactIds = pending.map(a => a.id);
    const jobId = await enqueueFileProcessingJob(bugId, artifactIds);
    res.json({ message: 'Processing enqueued', jobId, count: artifactIds.length });
  } catch (error) {
    console.error('Error enqueuing processing:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

// Generate a presigned URL to download an artifact (legacy - use artifactController for enhanced features)
exports.getArtifactDownloadUrl = async (req, res) => {
  try {
    const { artifactId } = req.params;
    const artifact = await Artifact.find(artifactId);
    if (!artifact) return res.status(404).json({ message: 'Artifact not found' });

    // Authorization via bug report/team
    const bugReport = await BugReport.find(artifact.bug_report_id);
    const teamMembers = await Team.getMembers(bugReport.team_id);
    const isMember = teamMembers.some(member => member.user_id === req.user.id);
    if (!isMember) return res.status(403).json({ message: 'Forbidden' });

    const s3 = new aws.S3({
      accessKeyId: process.env.AWS_ACCESS_KEY_ID,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
      region: process.env.AWS_REGION || 'us-east-1',
    });

    const url = s3.getSignedUrl('getObject', {
      Bucket: artifact.s3_bucket,
      Key: artifact.s3_key,
      Expires: 60 * 10,
      ResponseContentType: artifact.content_type || undefined,
    });

    res.json({ url });
  } catch (error) {
    console.error('Error generating download URL:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};
