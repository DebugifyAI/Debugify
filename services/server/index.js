///////////////////////////////
// Imports
///////////////////////////////

require('dotenv').config();
const path = require('path');
const express = require('express');

// middleware imports
const { jwtAuthMiddleware } = require('./middleware/jwtAuth');
const logRoutes = require('./middleware/logRoutes');
const logErrors = require('./middleware/logErrors');

// controller imports
const authControllers = require('./controllers/authControllers');
const userControllers = require('./controllers/userControllers');
const app = express();

// middleware
app.use(logRoutes); // print information about each incoming request
app.use(express.json()); // parse incoming request bodies as JSON
app.use(express.static(path.join(__dirname, '../static-assets'))); // Serve static assets from the static-assets folder

///////////////////////////////
// Auth Routes
///////////////////////////////

app.post('/api/auth/register', authControllers.registerUser);
app.post('/api/auth/login', authControllers.loginUser);
app.get('/api/auth/me', jwtAuthMiddleware, authControllers.showMe);
app.delete('/api/auth/logout', authControllers.logoutUser);

///////////////////////////////
// User Routes
///////////////////////////////

// These actions require users to be logged in (JWT authentication)
// Express lets us pass a piece of middleware to run for a specific endpoint
app.get('/api/users', jwtAuthMiddleware, userControllers.listUsers);
app.get('/api/users/:id', jwtAuthMiddleware, userControllers.showUser);
app.patch('/api/users/:id', jwtAuthMiddleware, userControllers.updateUser);

///////////////////////////////
// Fallback Routes
///////////////////////////////

// Requests meant for the API will be sent along to the router.
// For all other requests, send back the index.html file for SPA routing.
app.get('*', (req, res, next) => {
  if (req.originalUrl.startsWith('/api')) return next();
  res.sendFile(path.join(__dirname, '../static-assets/index.html'));
});

app.use(logErrors);

///////////////////////////////
// Start Listening
///////////////////////////////

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}/`);
});
