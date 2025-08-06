// JWT Token management
export const getToken = () => localStorage.getItem('jwt_token');
export const setToken = (token) => localStorage.setItem('jwt_token', token);
export const removeToken = () => localStorage.removeItem('jwt_token');

// Helper to get auth headers
const getAuthHeaders = () => {
  const token = getToken();
  return token ? { 'Authorization': `Bearer ${token}` } : {};
};

export const getGetOptions = () => ({
  method: 'GET',
  headers: {
    ...getAuthHeaders(),
  },
});

export const getDeleteOptions = () => ({
  method: 'DELETE',
  headers: {
    ...getAuthHeaders(),
  },
});

export const getPostOptions = (body) => ({
  method: 'POST',
  headers: { 
    'Content-Type': 'application/json',
    ...getAuthHeaders(),
  },
  body: JSON.stringify(body),
});

export const getPatchOptions = (body) => ({
  method: 'PATCH',
  headers: { 
    'Content-Type': 'application/json',
    ...getAuthHeaders(),
  },
  body: JSON.stringify(body),
});

export const fetchHandler = async (url, options = {}) => {
  try {
    const response = await fetch(url, options);
    const { ok, status, headers } = response;
    if (!ok) throw new Error(`Fetch failed with status - ${status}`, { cause: status });

    const isJson = (headers.get('content-type') || '').includes('application/json');
    const responseData = await (isJson ? response.json() : response.text());

    return [responseData, null];
  } catch (error) {
    console.warn(error);
    return [null, error];
  }
};
