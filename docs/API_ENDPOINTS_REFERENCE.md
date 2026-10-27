# GraveTrak REST API Endpoints Reference

> **Note**: This is a reference document. For the actual implementation, see `backend/api/views.py`

## Overview

All endpoints follow Django REST Framework best practices with:
- Role-based permissions
- Proper HTTP methods
- Comprehensive error handling
- Pagination and filtering

---

## API Permissions

### IsPublicUser
Check if user is a public user (applicant)

### IsMayorOffice
Check if user is from Mayor's Office

### IsCemeteryStaff
Check if user is Cemetery Staff

### IsCityPlanning
Check if user is City Planning (view-only)

### IsAdmin
Check if user is admin (staff)

---

## Pagination

**StandardPagination**
- Page size: 20
- Query param: `page_size`
- Max page size: 100

---

## Core Endpoints

### Burial Applications

#### POST /api/burial-applications/submit/
**Public users submit burial applications with documents**

**Request Body:**
```json
{
  "deceased_name": "John Doe",
  "deceased_date_of_death": "2026-05-01",
  "applicant_name": "Jane Doe",
  "applicant_relationship": "spouse",
  "applicant_contact_email": "jane@example.com",
  "applicant_contact_phone": "+1234567890",
  "applicant_address": "123 Main St, City"
}
```

**Response (201):**
```json
{
  "id": 1,
  "application_id": "BUR-2026-45678",
  "status": "pending_review",
  "created_at": "2026-05-06T10:00:00Z",
  "message": "Application submitted successfully"
}
```

---

## See Also
- `backend/api/views.py` - Actual implementation
- `SERIALIZERS_REFERENCE.md` - Serializer documentation
- `PLOT_LOGIC_REFERENCE.md` - Plot assignment logic
