import { fetchHandler, getPostOptions } from "../utils/fetchingUtils";

const baseUrl = "/api/bugs";

export const presignArtifactUpload = async (bugId, { filename, contentType }) => {
  return await fetchHandler(
    `${baseUrl}/${bugId}/presign`,
    getPostOptions({ filename, contentType })
  );
};

export const confirmArtifactUploads = async (bugId, uploads) => {
  return await fetchHandler(
    `${baseUrl}/${bugId}/confirm-uploads`,
    getPostOptions({ uploads })
  );
};


