const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'green-gold-dev-secret';

function generateToken(payload, expiresIn) {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: expiresIn || '8h' });
}

function extractToken(req) {
  const header = (req.headers.authorization || '').trim();
  if (header.toLowerCase().startsWith('bearer ')) return header.slice(7).trim();
  if (header) return header;
  if (req.cookies && req.cookies.token) return req.cookies.token;
  return null;
}

function authenticate(req, res, next) {
  const token = extractToken(req);
  if (!token) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    return next();
  } catch (e) {
    return res.status(401).json({ error: 'Invalid token' });
  }
}

function authorizeRole(roles) {
  const allowed = Array.isArray(roles) ? roles : [roles];
  return function (req, res, next) {
    if (!req.user) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    if (allowed.length > 0 && allowed.indexOf(req.user.role) === -1) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    return next();
  };
}

module.exports = {
  authenticate: authenticate,
  authorizeRole: authorizeRole,
  authorizeRoles: authorizeRole,
  generateToken: generateToken,
  signToken: generateToken
};