const express = require('express');
const {
  listUsers,
  createUser,
  updateUser,
  listRoles,
  createRole,
  listPermissions,
  updateRolePermissions,
} = require('../controllers/iam.controller');
const { authenticateToken, authorizeAnyPermission } = require('../middlewares/auth.middleware');

const router = express.Router();

router.use(authenticateToken);

router.get('/users', authorizeAnyPermission(['auth.users.read', 'auth.users.write']), listUsers);
router.post('/users', authorizeAnyPermission(['auth.users.write']), createUser);
router.patch('/users/:id', authorizeAnyPermission(['auth.users.write']), updateUser);

router.get('/roles', authorizeAnyPermission(['auth.roles.read', 'auth.roles.write']), listRoles);
router.post('/roles', authorizeAnyPermission(['auth.roles.write']), createRole);
router.put('/roles/:id/permissions', authorizeAnyPermission(['auth.roles.write']), updateRolePermissions);

router.get('/permissions', authorizeAnyPermission(['auth.roles.read', 'auth.roles.write']), listPermissions);

module.exports = router;
