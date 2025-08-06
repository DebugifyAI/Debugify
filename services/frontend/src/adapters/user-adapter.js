// These functions all take in a body and return an options object
// with the provided body and the remaining options
import { fetchHandler, getPatchOptions, getGetOptions } from "../utils/fetchingUtils";

const baseUrl = '/api/users';

export const getAllUsers = async () => {
  return await fetchHandler(baseUrl, getGetOptions());
};

export const getUser = async (id) => {
  return fetchHandler(`${baseUrl}/${id}`, getGetOptions());
}

export const updateUsername = async ({ id, username }) => {
  return fetchHandler(`${baseUrl}/${id}`, getPatchOptions({ id, username }))
}

