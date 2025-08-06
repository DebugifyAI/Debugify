import { fetchHandler, getPostOptions, getDeleteOptions, getGetOptions, setToken, removeToken } from "../utils/fetchingUtils";

const baseUrl = '/api/auth';

export const registerUser = async ({ username, password }) => {
  const [data, error] = await fetchHandler(`${baseUrl}/register`, getPostOptions({ username, password }));
  
  if (data && data.token) {
    setToken(data.token);
    return [data.user, null]; // Return user data to maintain API consistency
  }
  
  return [null, error];
};

export const logUserIn = async ({ username, password }) => {
  const [data, error] = await fetchHandler(`${baseUrl}/login`, getPostOptions({ username, password }));
  
  if (data && data.token) {
    setToken(data.token);
    return [data.user, null]; // Return user data to maintain API consistency
  }
  
  return [null, error];
};

export const logUserOut = async () => {
  const [data, error] = await fetchHandler(`${baseUrl}/logout`, getDeleteOptions());
  
  // Always remove token from localStorage on logout, regardless of server response
  removeToken();
  
  return [data, error];
};

export const checkForLoggedInUser = async () => {
  return await fetchHandler(`${baseUrl}/me`, getGetOptions());
};
