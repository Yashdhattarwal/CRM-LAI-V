# CRM Staff Access Control & Privilege Matrix

This document provides a detailed breakdown of permissions, roles, and administrative capabilities within the CRM system. These rules are enforced directly by the backend Node.js API endpoints (`server.js`) and reflected dynamically by the UI elements in the Admin Portal.

---

## 👥 Role Overview

The CRM system supports three tiers of staff accounts:

1. **🔴 Admin (Super User)**: Complete, unrestricted control over the entire platform. Handles database integrity, staff management, audit trails, and archival restorations.
2. **🟡 Manager**: Operational coordinator. Manages customer registrations, updates client activation statuses, and edits lottery database references.
3. **🟢 Employee**: Read-only operator. Interacts with customers, logs updates/comments, and records purchases. Cannot edit system status settings, modify registrations, or edit lottery ticket references.

---

## 📊 Privilege Matrix Table

| Feature / Action | 🔴 Admin | 🟡 Manager | 🟢 Employee | Backend Enforcer |
| :--- | :---: | :---: | :---: | :--- |
| **View Client Registrations** | ✅ | ✅ | ✅ | `GET /api/admin/registrations` |
| **View Analytics & Dashboards** | ✅ | ✅ | ✅ | `GET /api/admin/stats` |
| **Log Support Note/Comment** | ✅ | ✅ | ✅ | `POST /api/admin/support-comment` |
| **Record Client Purchase (e-Cheque/Card)** | ✅ | ✅ | ✅ | `POST /api/admin/purchase-history` |
| **Delete Own Support Comments** | ✅ | ✅ | ✅ | `DELETE /api/admin/support-comments/:id` |
| **Update Client Details / Status** | ✅ | ✅ | ❌ *Read-only* | `PATCH /api/admin/users/:id` |
| **Add Lottery Ticket Reference** | ✅ | ✅ | ❌ *Read-only* | `POST /api/admin/tickets` |
| **Edit Lottery Ticket Reference** | ✅ | ✅ | ❌ *Read-only* | `PATCH /api/admin/tickets/:id` |
| **Delete Lottery Ticket Reference** | ✅ | ✅ | ❌ *Read-only* | `DELETE /api/admin/tickets/:id` |
| **Delete Other Staff's Comments** | ✅ | ❌ | ❌ | `DELETE /api/admin/support-comments/:id` |
| **Add New Staff (Admin/Manager/Emp)** | ✅ | ❌ | ❌ | `POST /api/admin/staff` |
| **Delete/Revoke Staff Access** | ✅ | ❌ | ❌ | `DELETE /api/admin/staff/:id` |
| **Restore Archived (Deleted) Clients** | ✅ | ❌ | ❌ | `POST /api/admin/registrations/restore/:id` |
| **Delete Client Status Logs (Audit Trail)** | ✅ | ❌ | ❌ | `DELETE /api/admin/registrations/status-log/:id` |

---

## 🔒 Technical Enforcement (Behind the Scenes)

### 1. Unified Authentication Middleware (`adminOnly`)
Every staff endpoint is protected by a core security guard. This middleware ensures the user is logged in as a valid staff tier:
```javascript
function adminOnly(req, res, next) {
  if (req.session.isAdmin) {
    if (!req.session.role) req.session.role = 'admin'; 
    if (['admin', 'manager', 'employee'].includes(req.session.role)) {
      return next();
    }
  }
  res.status(403).json({ error: 'Unauthorized. Admin login required.' });
}
```

### 2. Employee Modification Lock
To protect client data integrity, employees are strictly blocked from editing client information or lottery databases. Attempting to access these endpoints will return:
```javascript
if (req.session.role === 'employee') {
  return res.status(403).json({ error: 'Read-only access' });
}
```

### 3. Support Comment Ownership Rule
While **Admins** can clean up any comments, **Managers** and **Employees** are only allowed to delete comments that they personally authored:
```javascript
if (comment.staff_id !== req.session.userId && req.session.role !== 'admin') {
  return res.status(403).json({ error: 'Unauthorized' });
}
```

### 4. Admin Management Firewall
Only true Admins can add or remove personnel from the system, restore deleted profiles, or delete status change audit records:
```javascript
if (req.session.role !== 'admin') {
  return res.status(403).json({ error: 'Requires Admin role' });
}
```
