const User = require('../models/User');
const { generateToken } = require('../middleware/jwtAuth');

exports.registerUser = async (req, res) => {
  // Request needs a body
  if (!req.body) {
    return res.status(400).send({ message: 'Username and password required' });
  }

  // Body needs a username and password
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).send({ message: 'Username and password required' });
  }

  // User.create will handle hashing the password and storing in the database
  const user = await User.create(username, password);

  // Generate JWT token and send back with user data
  const token = generateToken(user);
  res.json({ 
    user: user.getPublicProfile(),
    token,
    message: 'User registered successfully'
  });
};

exports.loginUser = async (req, res) => {
  // Request needs a body
  if (!req.body) {
    return res.status(400).send({ message: 'Username and password required' });
  }

  // Body needs a username and password
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).send({ message: 'Username and password required' });
  }

  // Username must be valid
  const user = await User.findByUsername(username);
  if (!user) {
    return res.status(404).send({ message: 'User not found.' });
  }

  // Password must match
  const isPasswordValid = await user.isValidPassword(password);
  if (!isPasswordValid) {
    return res.status(401).send({ message: 'Invalid credentials.' });
  }

  // Generate JWT token and send back with user data
  const token = generateToken(user);
  res.json({ 
    user: user.getPublicProfile(),
    token,
    message: 'Login successful'
  });
};


exports.showMe = async (req, res) => {
  // JWT middleware ensures req.user exists for authenticated requests
  // Get the full user data from database
  const user = await User.find(req.user.id);
  if (!user) {
    return res.status(404).send({ message: "User not found." });
  }
  
  res.json(user.getPublicProfile());
};

exports.logoutUser = (req, res) => {
  // With JWT, logout is handled client-side by removing the token
  // Server doesn't need to do anything as JWTs are stateless
  res.json({ message: "User logged out successfully." });
};