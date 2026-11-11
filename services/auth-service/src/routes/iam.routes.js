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
const { createWarehouseAssignmentController } = require('../controllers/warehouse-assignment.controller');

const router = express.Router();
const assignment = createWarehouseAssignmentController();

router.use(authenticateToken);

router.get('/users', authorizeAnyPermission(['auth.users.read', 'auth.users.write']), listUsers);
router.post('/users', authorizeAnyPermission(['auth.users.write']), createUser);
router.patch('/users/:id', authorizeAnyPermission(['auth.users.write']), updateUser);

// Warehouse assignment: admins for everyone, warehouse managers for their own
// warehouses' staff (rules in lib/warehouse-assignment.js).
router.get('/users/:id/warehouse-scopes', assignment.authorizeAssignmentManager, assignment.getUserWarehouseScopes);
router.put('/users/:id/warehouse-scopes', assignment.authorizeAssignmentManager, assignment.replaceUserWarehouseScopes);
router.get('/warehouses/:warehouseId/staff', assignment.authorizeAssignmentManager, assignment.listStaffOfWarehouse);

router.get('/roles', authorizeAnyPermission(['auth.roles.read', 'auth.roles.write']), listRoles);
router.post('/roles', authorizeAnyPermission(['auth.roles.write']), createRole);
router.put('/roles/:id/permissions', authorizeAnyPermission(['auth.roles.write']), updateRolePermissions);

router.get('/permissions', authorizeAnyPermission(['auth.permissions.read', 'auth.permissions.write', 'auth.roles.read', 'auth.roles.write']), listPermissions);

module.exports = router;
