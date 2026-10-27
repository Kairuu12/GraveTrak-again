================================================================================
        GRAVETRAK: STATUS LIFECYCLE & PERMISSIONS
================================================================================

STATUS ENUM DEFINITION
================================================================================

class ApplicationStatus(models.TextChoices):
    PENDING_REVIEW = 'pending_review', 'Pending Review'
    ACTION_REQUIRED = 'action_required', 'Action Required'
    SLOT_ASSIGNED = 'slot_assigned', 'Slot Assigned'
    APPROVED = 'approved', 'Approved'
    FOR_INTERVIEW = 'for_interview', 'For Interview'
    SCHEDULED = 'scheduled', 'Scheduled'
    COMPLETED = 'completed', 'Completed'
    REJECTED = 'rejected', 'Rejected'


STATUS LIFECYCLE & OWNERSHIP
================================================================================

┌─ PENDING_REVIEW ──────────────────────────────────────────────────────────┐
│                                                                             │
│ Initial Status: Set when user submits application                          │
│                                                                             │
│ Who can create: PUBLIC USER (automatic on submission)                      │
│ Who can update: MAYOR'S OFFICE                                             │
│ Who can view: PUBLIC USER (own), MAYOR'S OFFICE, CEMETERY STAFF            │
│                                                                             │
│ Transitions:                                                               │
│  → ACTION_REQUIRED   (Mayor validates docs, finds invalid → request resubmit) │
│  → SLOT_ASSIGNED     (Mayor validates docs, found valid → system assigns plot) │
│                                                                             │
│ Duration: Typically 1-3 days                                               │
│ Notification: User gets "Application received" message                      │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘

┌─ ACTION_REQUIRED ─────────────────────────────────────────────────────────┐
│                                                                             │
│ Status: Documents are incomplete/invalid                                   │
│         User MUST resubmit with corrected documents                        │
│                                                                             │
│ Who can create: MAYOR'S OFFICE (documents found invalid)                  │
│ Who can update: PUBLIC USER (resubmits) → becomes PENDING_REVIEW           │
│ Who can view: PUBLIC USER (own), MAYOR'S OFFICE                            │
│                                                                             │
│ Transitions:                                                               │
│  → PENDING_REVIEW    (User resubmits documents → back to review)           │
│                                                                             │
│ Reason stored: String field with reason for rejection                      │
│ Notification: User gets "Documents incomplete. Reason: [detail]"           │
│                                                                             │
│ Loop allowed: Users can resubmit up to N times                             │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘

┌─ SLOT_ASSIGNED ───────────────────────────────────────────────────────────┐
│                                                                             │
│ Status: Documents valid, system automatically assigned burial plot         │
│         Waiting for mayor's final approval/rejection                       │
│                                                                             │
│ Who can create: SYSTEM (automatic, triggered by valid documents)           │
│ Who can update: MAYOR'S OFFICE (approves/rejects)                          │
│ Who can view: MAYOR'S OFFICE, CEMETERY STAFF                               │
│ Who CANNOT view: PUBLIC USER (hidden until approved)                       │
│                                                                             │
│ Plot assignment:                                                           │
│  • assigned_plot → FK to BurialPlot (locked in)                            │
│  • Plot status remains AVAILABLE (not OCCUPIED)                            │
│  • Plot.reserved_by = application_id                                       │
│                                                                             │
│ Transitions:                                                               │
│  → APPROVED          (Mayor grants approval)                               │
│  → REJECTED          (Mayor denies request)                                │
│                                                                             │
│ Duration: Typically 1-2 days                                               │
│ Notification: None yet (plot is private until approval)                    │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘

┌─ APPROVED ────────────────────────────────────────────────────────────────┐
│                                                                             │
│ Status: Application approved, burial plot confirmed                        │
│         Waiting to schedule interview                                      │
│                                                                             │
│ Who can create: MAYOR'S OFFICE (approves application)                      │
│ Who can update: MAYOR'S OFFICE (schedules interview → FOR_INTERVIEW)       │
│ Who can view: PUBLIC USER (own), MAYOR'S OFFICE, CEMETERY STAFF            │
│                                                                             │
│ Actions available:                                                         │
│  • User can see assigned plot for first time                               │
│  • Mayor can schedule interview                                            │
│                                                                             │
│ Transitions:                                                               │
│  → FOR_INTERVIEW     (Mayor schedules interview)                           │
│                                                                             │
│ Duration: 1-7 days until interview                                         │
│ Notification: User gets "Application approved! Plot [X] assigned"          │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘

┌─ FOR_INTERVIEW ───────────────────────────────────────────────────────────┐
│                                                                             │
│ Status: Interview is scheduled                                             │
│         Mayor's office and applicant must complete interview               │
│                                                                             │
│ Who can create: MAYOR'S OFFICE (schedules interview)                       │
│ Who can update: MAYOR'S OFFICE (after interview → SCHEDULED)               │
│ Who can view: PUBLIC USER (own), MAYOR'S OFFICE, CEMETERY STAFF            │
│                                                                             │
│ Interview record: InterviewSchedule object created                         │
│  • date, time, location                                                    │
│  • instructions, notes                                                     │
│  • completed flag                                                          │
│                                                                             │
│ Transitions:                                                               │
│  → SCHEDULED         (After interview, burial schedule set)                │
│                                                                             │
│ Duration: Interview must happen within 7-14 days                           │
│ Notification: User gets "Interview scheduled for [date] [time]"            │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘

┌─ SCHEDULED ───────────────────────────────────────────────────────────────┐
│                                                                             │
│ Status: Burial date/time confirmed                                         │
│         Burial will happen on scheduled date                               │
│         Ready for cemetery staff to execute                                │
│                                                                             │
│ Who can create: MAYOR'S OFFICE (sets burial schedule after interview)      │
│ Who can update: CEMETERY STAFF (executes burial → COMPLETED)               │
│ Who can view: PUBLIC USER (own), MAYOR'S OFFICE, CEMETERY STAFF            │
│                                                                             │
│ Schedule details:                                                          │
│  • burial_date                                                             │
│  • burial_time                                                             │
│  • burial_location                                                         │
│  • instructions for staff                                                  │
│                                                                             │
│ Transitions:                                                               │
│  → COMPLETED         (Cemetery staff executes burial)                      │
│                                                                             │
│ Duration: Typically burial within 3-7 days                                 │
│ Notification: User gets "Burial scheduled for [date] at [time]"            │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘

┌─ COMPLETED ───────────────────────────────────────────────────────────────┐
│                                                                             │
│ Status: Burial executed successfully                                       │
│         Application is archived/completed                                  │
│                                                                             │
│ Who can create: CEMETERY STAFF (marks burial as executed)                  │
│ Who can update: NO ONE (final state)                                       │
│ Who can view: PUBLIC USER (own), MAYOR'S OFFICE, CEMETERY STAFF, ADMIN     │
│                                                                             │
│ Final updates:                                                             │
│  • burial_date = today()                                                   │
│  • assigned_plot.status = OCCUPIED                                         │
│  • assigned_plot.reserved_by = null                                        │
│  • completion_note (optional)                                              │
│                                                                             │
│ Transitions: NONE (final state)                                            │
│                                                                             │
│ Duration: Forever (archived)                                               │
│ Notification: User gets "Burial completed successfully"                    │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘

┌─ REJECTED ────────────────────────────────────────────────────────────────┐
│                                                                             │
│ Status: Application was denied                                             │
│         No burial will be performed                                        │
│                                                                             │
│ Who can create: MAYOR'S OFFICE (rejects application)                       │
│ Who can update: NO ONE (final state)                                       │
│ Who can view: PUBLIC USER (own), MAYOR'S OFFICE, ADMIN                     │
│                                                                             │
│ Rejection details:                                                         │
│  • rejection_reason (string)                                               │
│  • rejected_by (FK to User - mayor who rejected)                           │
│  • rejected_at (timestamp)                                                 │
│                                                                             │
│ Plot release:                                                              │
│  • If plot was assigned → make it AVAILABLE again                          │
│  • Clear assigned_plot                                                     │
│                                                                             │
│ Transitions: NONE (final state)                                            │
│                                                                             │
│ Duration: Forever (archived)                                               │
│ Notification: User gets "Application rejected. Reason: [detail]"           │
│                                                                             │
│ Appeal: User may resubmit new application (restart workflow)               │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘


PERMISSION MATRIX
================================================================================

                  │ Create │ Read │ Update │ Delete │ Status Update
──────────────────┼────────┼──────┼────────┼────────┼──────────────
Public User       │  ✓*    │ Own  │ Own**  │   ✗    │     ✗
Mayor's Office    │   ✗    │  ✓   │   ✓    │   ✗    │     ✓
City Planning     │   ✗    │  ✓   │   ✗    │   ✗    │     ✗
Cemetery Staff    │   ✗    │  ✓   │   ✓    │   ✗    │  ✓***
Admin             │   ✗    │  ✓   │   ✓    │   ✓    │     ✓

* Only PENDING_REVIEW on initial creation
** Can only update documents if status = ACTION_REQUIRED
*** Can only set to COMPLETED


STATUS QUERY RULES (What users see)
================================================================================

Public User Dashboard (views own applications):
  ✓ Can see: APPROVED, FOR_INTERVIEW, SCHEDULED, COMPLETED
  ✗ Cannot see: PENDING_REVIEW, ACTION_REQUIRED (privacy), SLOT_ASSIGNED, REJECTED (sensitive)
  ✗ Cannot see: Other users' applications (security)

Mayor's Office Dashboard (reviews all applications):
  ✓ Can see: ALL statuses
  ✓ Can filter by status
  ✓ Can see assigned plots (SLOT_ASSIGNED)
  ✓ Can see rejection reasons

Cemetery Staff Dashboard (views upcoming burials):
  ✓ Can see: SCHEDULED, COMPLETED
  ✓ Cannot see: PENDING_REVIEW, ACTION_REQUIRED, REJECTED
  ✓ Can see burial details and instructions

City Planning Dashboard (analytics only):
  ✓ Can see: Completed burials count
  ✓ Can see: Available plots count
  ✓ Can see: Section utilization
  ✗ Cannot modify anything

Admin Dashboard:
  ✓ Can see: Everything
  ✓ Can see: Audit logs
  ✓ Can delete records


AUTO-TRANSITIONS (System triggered, no user action)
================================================================================

Transition 1: Documents Valid → Auto-assign plot
  Trigger: Mayor validates documents (sets status → something positive)
  Logic: 
    1. System queries first available plot
    2. Assigns to application
    3. Sets status = SLOT_ASSIGNED
  Time: Immediate (synchronous)
  Who initiates: System (in background task or signal)

Transition 2: Interview completed → Set burial schedule
  Trigger: Mayor marks interview as completed
  Logic:
    1. Set burial_date, burial_time
    2. Update status = SCHEDULED
  Time: Same day (mayor action)
  Who initiates: Mayor

Transition 3: Scheduled burial → Mark as completed
  Trigger: Cemetery staff marks burial executed
  Logic:
    1. Set completion_date = today()
    2. Update plot status = OCCUPIED
    3. Set application status = COMPLETED
  Time: On burial date
  Who initiates: Cemetery staff


STATUS VALIDATION RULES
================================================================================

These transitions are VALID:

PENDING_REVIEW → ACTION_REQUIRED        ✓ (Mayor found docs invalid)
PENDING_REVIEW → SLOT_ASSIGNED          ✓ (Mayor found docs valid)

ACTION_REQUIRED → PENDING_REVIEW        ✓ (User resubmits)

SLOT_ASSIGNED → APPROVED                ✓ (Mayor approves)
SLOT_ASSIGNED → REJECTED                ✓ (Mayor rejects)

APPROVED → FOR_INTERVIEW                ✓ (Mayor schedules interview)

FOR_INTERVIEW → SCHEDULED               ✓ (Mayor sets burial date)

SCHEDULED → COMPLETED                   ✓ (Cemetery staff executes)

REJECTED → (none)                       ✓ (Terminal state)
COMPLETED → (none)                      ✓ (Terminal state)


These transitions are INVALID (system should reject):

PENDING_REVIEW → APPROVED               ✗ (Skip SLOT_ASSIGNED)
PENDING_REVIEW → REJECTED               ✗ (Must validate first)
ACTION_REQUIRED → APPROVED              ✗ (Must resubmit docs first)
SLOT_ASSIGNED → PENDING_REVIEW          ✗ (Cannot go backwards)
SCHEDULED → PENDING_REVIEW              ✗ (Cannot go backwards)
COMPLETED → SCHEDULED                   ✗ (Terminal state)
Etc.


AUDIT TRAIL (Log all transitions)
================================================================================

For each status transition, log:
  - Application ID
  - Old status
  - New status
  - Changed by (user_id)
  - Changed at (timestamp)
  - Reason (optional comment)
  - IP address (for security)

Example audit entry:
{
  "application_id": 5,
  "old_status": "PENDING_REVIEW",
  "new_status": "ACTION_REQUIRED",
  "changed_by": 12,  // Mayor's user ID
  "changed_at": "2026-05-06 14:32:10",
  "reason": "Death certificate missing official seal",
  "ip_address": "192.168.1.100"
}

================================================================================
