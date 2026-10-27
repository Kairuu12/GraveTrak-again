# GraveTrak Plot Assignment Logic Reference

> **Note**: This is a reference document. For the actual implementation, see `backend/api/workflow.py`

## Overview

Core business logic for automatic burial plot allocation using rule-based system.

**Key Feature**: NO manual City Planning action required - all automatic.

---

## Plot Assignment Engine

### Rule-Based Assignment

**Rules (in priority order):**
1. Find first AVAILABLE plot
2. Sort by section (A, B, C... or configured order)
3. Sort by plot_number (ascending - lowest first)
4. Assign to application
5. Lock plot (mark as reserved)

### Default Section Order

```
SEC_A, SEC_B, SEC_C, SEC_D, SEC_E
```

Can be configured via SystemSettings.

---

## Core Methods

### assign_plot_to_application(application)

Automatically assign the next available plot to an application.

**Args:**
- `application` (BurialApplication): The application to assign plot to

**Returns:**
- Tuple: `(plot, success, message)`
  - `plot`: BurialPlot if successful, None if failed
  - `success`: Boolean
  - `message`: String describing result

**Raises:**
- `ValueError`: If application already has a plot
- `IntegrityError`: If database transaction fails

**Validation:**
- Cannot reassign if plot already assigned
- Application must be in PENDING_REVIEW or SLOT_ASSIGNED status

**Process (Atomic Transaction):**
1. Get next available plot
2. Assign plot to application
3. Update application status to SLOT_ASSIGNED
4. Mark plot as reserved
5. Log the assignment

### get_next_available_plot()

Find next available plot using rule-based logic.

**Rule:**
1. Status = AVAILABLE (not OCCUPIED or MAINTENANCE)
2. Sort by section (priority order from config)
3. Sort by plot_number (ascending)
4. Return first match

**Returns:**
- `BurialPlot` or `None` if no available plots

---

## Status Transitions

### Plot Statuses
- `AVAILABLE` - Open for assignment
- `OCCUPIED` - Already in use
- `RESERVED` - Assigned to application
- `MAINTENANCE` - Temporarily unavailable

### Application Statuses
- `PENDING_REVIEW` - Initial state
- `ACTION_REQUIRED` - Needs corrections
- `SLOT_ASSIGNED` - Plot assigned
- `APPROVED` - Final approval
- `FOR_INTERVIEW` - Interview scheduled
- `SCHEDULED` - Confirmed
- `COMPLETED` - Burial completed
- `REJECTED` - Application denied

---

## Example Workflow

```
1. User submits burial application
   → Application created (PENDING_REVIEW)

2. Admin reviews application
   → Triggers automatic plot assignment
   → get_next_available_plot() searches for available plot
   → Found: Section A, Plot 42
   → assign_plot_to_application() assigns it
   → Application status → SLOT_ASSIGNED

3. Application continues through workflow
   → FOR_INTERVIEW, SCHEDULED, COMPLETED
   → Plot status → OCCUPIED
```

---

## Database Transactions

All plot assignments use atomic transactions to ensure:
- No race conditions
- Consistent data state
- Rollback on failure

---

## See Also
- `backend/api/workflow.py` - Actual implementation
- `API_ENDPOINTS_REFERENCE.md` - Endpoint documentation
- `SERIALIZERS_REFERENCE.md` - Serializer documentation
