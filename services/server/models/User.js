const knex = require('../db/knex');
const bcrypt = require('bcrypt');
const SALT_ROUNDS = 12;

class User {
  #passwordHash = null; // a private property

  // Create a User instance with the password hidden
  // Instances of User can be sent to clients without exposing the password
  constructor({ id, username, name, email, password_hash, created_at, updated_at }) {
    this.id = id;
    this.username = username;
    this.name = name;
    this.email = email;
    this.created_at = created_at;
    this.updated_at = updated_at;
    this.#passwordHash = password_hash;
  }

  // Controllers can use this instance method to validate passwords prior to sending responses
  isValidPassword = async (password) => {
    return await bcrypt.compare(password, this.#passwordHash);
  }

  // Hashes the given password and then creates a new user
  // in the users table. Returns the newly created user, using
  // the constructor to hide the passwordHash. 
  // Updated for JWT authentication - simplified signature
  static async create(username, password, name = null, email = null) {
    // Validate required parameters
    if (!username || !password) {
      throw new Error('Username and password are required');
    }

    // Check if username already exists
    const existingUser = await User.findByUsername(username);
    if (existingUser) {
      throw new Error('Username already exists');
    }

    // hash the plain-text password using bcrypt before storing it in the database
    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);

    // Generate default name and email if not provided
    const userName = name || `User_${username}`;
    const userEmail = email || `${username}@example.com`;

    try {
      const query = `INSERT INTO users (username, name, email, password_hash)
        VALUES (?, ?, ?, ?) RETURNING *`;
      const result = await knex.raw(query, [username, userName, userEmail, passwordHash]);

      const rawUserData = result.rows[0];
      return new User(rawUserData);
    } catch (error) {
      // Handle database constraint errors
      if (error.code === '23505') { // PostgreSQL unique violation
        throw new Error('Username already exists');
      }
      throw error;
    }
  }

  // Fetches ALL users from the users table, uses the constructor
  // to format each user (and hide their password hash), and returns.
  static async list() {
    const query = `SELECT * FROM users`;
    const result = await knex.raw(query);
    return result.rows.map((rawUserData) => new User(rawUserData));
  }

  // Fetches A single user from the users table that matches
  // the given user id. If it finds a user, uses the constructor
  // to format the user and returns or returns null if not.
  static async find(id) {
    const query = `SELECT * FROM users WHERE id = ?`;
    const result = await knex.raw(query, [id]);
    const rawUserData = result.rows[0];
    return rawUserData ? new User(rawUserData) : null;
  }


  // Same as above but uses the username to find the user
  static async findByUsername(username) {
    const query = `SELECT * FROM users WHERE username = ?`;
    const result = await knex.raw(query, [username]);
    const rawUserData = result.rows[0];
    return rawUserData ? new User(rawUserData) : null;
  }

  // Updates the user that matches the given id with a new username.
  // Returns the modified user, using the constructor to hide the passwordHash. 
  static async update(id, username) {
    // Validate input
    if (!id || !username) {
      throw new Error('User ID and username are required');
    }

    // Check if the new username already exists (excluding current user)
    const existingUser = await User.findByUsername(username);
    if (existingUser && existingUser.id !== parseInt(id)) {
      throw new Error('Username already exists');
    }

    try {
      const query = `
        UPDATE users
        SET username = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
        RETURNING *
      `;
      const result = await knex.raw(query, [username, id]);
      const rawUpdatedUser = result.rows[0];
      return rawUpdatedUser ? new User(rawUpdatedUser) : null;
    } catch (error) {
      // Handle database constraint errors
      if (error.code === '23505') { // PostgreSQL unique violation
        throw new Error('Username already exists');
      }
      throw error;
    }
  };

  // Updates the user's password
  static async updatePassword(id, newPassword) {
    // Validate input
    if (!id || !newPassword) {
      throw new Error('User ID and password are required');
    }

    // hash the new password
    const passwordHash = await bcrypt.hash(newPassword, SALT_ROUNDS);

    const query = `
      UPDATE users
      SET password_hash = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
      RETURNING *
    `;
    const result = await knex.raw(query, [passwordHash, id]);
    const rawUpdatedUser = result.rows[0];
    return rawUpdatedUser ? new User(rawUpdatedUser) : null;
  }

  // Returns user data safe for public consumption (no sensitive info)
  getPublicProfile() {
    return {
      id: this.id,
      username: this.username,
      name: this.name,
      email: this.email,
      created_at: this.created_at,
      updated_at: this.updated_at
    };
  }

  // Helper method for JWT payload
  getJWTPayload() {
    return {
      id: this.id,
      username: this.username,
      name: this.name
    };
  }

  static async deleteAll() {
    return knex('users').del()
  }
}

module.exports = User;
