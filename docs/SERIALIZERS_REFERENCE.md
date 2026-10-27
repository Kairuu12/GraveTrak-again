# GraveTrak Serializers Reference

> **Note**: This is a reference document. For the actual implementation, see `backend/api/serializers.py`

## Overview

Serializers for all models with proper validation and nested relationships.

---

## Burial Plot Serializers

### BurialPlotSerializer
Minimal plot information for list/detail views

**Fields:**
- `id` - Plot ID
- `plot_id` - External plot identifier
- `section` - Cemetery section
- `plot_number` - Plot number within section
- `status` - Plot status (available, occupied, reserved, maintenance)
- `location_description` - Description of plot location
- `latitude` - GPS latitude
- `longitude` - GPS longitude

All fields are read-only.

### BurialPlotDetailSerializer
Detailed plot information with relationships

**Additional Fields:**
- `assigned_application` - Related burial application
- `notes` - Additional notes
- `created_at` - Creation timestamp
- `updated_at` - Last update timestamp

---

## Burial Document Serializers

### BurialDocumentUploadSerializer
For uploading documents

**Fields:**
- `document_type` - Type of document
- `document_file` - File upload

**Validation:**
- Maximum file size: 10MB
- Supported formats: PDF, JPG, PNG, DOCX

### BurialDocumentSerializer
Display document information

**Fields:**
- `id` - Document ID
- `document_type` - Document type
- `document_type_display` - Human-readable type
- `file_name` - Original filename
- `file_size` - File size in bytes
- `verified` - Verification status
- `verification_note` - Verification notes
- `verified_by_name` - Name of verifier
- `uploaded_at` - Upload timestamp

---

## Interview Schedule Serializer

### InterviewScheduleSerializer
Interview schedule information

See `backend/api/serializers.py` for complete implementation.

---

## See Also
- `backend/api/serializers.py` - Actual implementation
- `API_ENDPOINTS_REFERENCE.md` - Endpoint documentation
- `PLOT_LOGIC_REFERENCE.md` - Plot assignment logic
