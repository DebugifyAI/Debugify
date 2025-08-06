const jwt = require('jsonwebtoken');

// JWT secret key from environment variable
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production';
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '24h';

/**
 * Generate a JWT token for a user
 * @param {Object} user - User object with id and username
 * @returns {string} JWT token
 */
const generateToken = (user) => {
  // Use the user's getJWTPayload method if available, otherwise fallback
  const payload = user.getJWTPayload ? user.getJWTPayload() : {
    id: user.id,
    username: user.username
  };
  
  return jwt.sign(payload, JWT_SECRET, {
    expiresIn: JWT_EXPIRES_IN,
    issuer: 'debugify-server'
  });
};

/**
 * Verify JWT token
 * @param {string} token - JWT token
 * @returns {Object|null} Decoded payload or null if invalid
 */
const verifyToken = (token) => {
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch (error) {
    console.error('JWT verification failed:', error.message);
    return null;
  }
};

/**
 * JWT Authentication Middleware
 * Replaces session-based authentication
 */
const jwtAuthMiddleware = (req, res, next) => {
  // Extract token from Authorization header
  const authHeader = req.headers.authorization;
  
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ 
      message: 'Access denied. No token provided or invalid format.' 
    });
  }
  
  const token = authHeader.substring(7); // Remove 'Bearer ' prefix
  
  // Verify the token
  const decoded = verifyToken(token);
  
  if (!decoded) {
    return res.status(401).json({ 
      message: 'Access denied. Invalid token.' 
    });
  }
  
  // Add user info to request object (similar to req.session.userId)
  req.user = {
    id: decoded.id,
    username: decoded.username
  };
  
  next();
};

module.exports = {
  generateToken,
  verifyToken,
  jwtAuthMiddleware
};