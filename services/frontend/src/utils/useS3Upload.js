import { presignArtifactUpload, confirmArtifactUploads } from "../adapters/artifacts-adapter";

// Reusable helper to upload files directly to S3 using PUT presigned URLs,
// then confirm uploads with the backend.
export async function uploadArtifactsDirectToS3({ bugId, files }) {
  const uploaded = [];

  for (const file of files) {
    // 1) presign
    const [presign, presignErr] = await presignArtifactUpload(bugId, {
      filename: file.name,
      contentType: file.type || "application/octet-stream",
    });
    if (presignErr || !presign?.url) {
      throw presignErr || new Error("Failed to presign upload");
    }

    const { url, headers, bucket, key } = presign;

    // 2) upload directly to S3 via PUT
    const resp = await fetch(url, {
      method: "PUT",
      headers: headers || { "Content-Type": file.type || "application/octet-stream" },
      body: file,
    });
    if (!resp.ok) {
      throw new Error(`S3 upload failed: ${resp.status}`);
    }

    const etag = resp.headers.get("ETag");
    uploaded.push({
      bucket,
      key,
      contentType: file.type || "application/octet-stream",
      sizeBytes: file.size,
      etag,
      originalName: file.name,
    });
  }

  // 3) confirm all uploads with backend
  const [confirm, confirmErr] = await confirmArtifactUploads(bugId, uploaded);
  if (confirmErr) {
    throw confirmErr;
  }
  return confirm; // { artifacts, jobId }
}


