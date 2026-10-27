================================================================================
        GRAVETRAK: BURIAL APPLICATION SYSTEM FLOW
        Public Government Cemetery Management
================================================================================

COMPLETE WORKFLOW WITH ROLE ASSIGNMENT
================================================================================

                                ┌─── START ───┐
                                      │
                                      ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│ STEP 1: PUBLIC USER - APPLICATION SUBMISSION                               │
│                                                                              │
│  • Fill application form:                                                   │
│    - Deceased name, age, date of death                                      │
│    - Applicant name, relationship, contact info                             │
│                                                                              │
│  • Upload required documents:                                               │
│    - Death certificate                                                      │
│    - Proof of citizenship (deceased)                                        │
│    - Family relationship proof                                              │
│    - Burial permit (if any)                                                 │
│                                                                              │
│  • System creates: BurialApplication record                                 │
│  • Status: PENDING_REVIEW                                                   │
│  • Notification: "Application received. Awaiting mayor's office review."    │
└──────────────────────────────────────────────────────────────────────────────┘
                                      │
                                      ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│ STEP 2: MAYOR'S OFFICE - DOCUMENT REVIEW                                    │
│                                                                              │
│  DECISION POINT A: Document Validation                                      │
│                                                                              │
│  ┌─ IF DOCUMENTS INVALID ──────────────────────────────────────────┐        │
│  │  • Reject application                                           │        │
│  │  • Status: ACTION_REQUIRED                                      │        │
│  │  • Set reason for rejection                                     │        │
│  │  • Notify user: "Documents incomplete. Please resubmit."        │        │
│  │  ──→ User can RESUBMIT at Step 1                               │        │
│  └─────────────────────────────────────────────────────────────────┘        │
│                                                                              │
│  ┌─ IF DOCUMENTS VALID ────────────────────────────────────────────┐        │
│  │  • Documents approved                                           │        │
│  │  • Proceed to Step 3 (automatic plot assignment)                │        │
│  └─────────────────────────────────────────────────────────────────┘        │
└──────────────────────────────────────────────────────────────────────────────┘
                                      │
                                      ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│ STEP 3: SYSTEM (AUTOMATED) - PLOT ASSIGNMENT                                │
│                                                                              │
│  • Logic:                                                                    │
│    1. Query all plots with status = AVAILABLE                               │
│    2. Sort by section (SEC_A → SEC_B → SEC_C...)                            │
│    3. Sort by plot_number (ascending)                                       │
│    4. Assign FIRST available plot to application                            │
│                                                                              │
│  • Update Plot: assigned_to = application_id                                │
│  • Status: SLOT_ASSIGNED                                                    │
│  • Do NOT change plot status to OCCUPIED yet                                │
│    (Plot remains AVAILABLE for display, but is reserved)                    │
│                                                                              │
│  • No City Planning manual action required (fully automated)                 │
│  • No user notification yet (notification at approval)                       │
└──────────────────────────────────────────────────────────────────────────────┘
                                      │
                                      ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│ STEP 4: MAYOR'S OFFICE - FINAL APPROVAL                                     │
│                                                                              │
│  DECISION POINT B: Grant or Deny Burial Request                             │
│                                                                              │
│  ┌─ IF REJECTED ───────────────────────────────────────────────────┐        │
│  │  • Set rejection reason                                         │        │
│  │  • Status: REJECTED                                             │        │
│  │  • De-assign plot (make it AVAILABLE again)                     │        │
│  │  • Notify user: "Application denied. Reason: [reason]"          │        │
│  │  • END WORKFLOW                                                 │        │
│  └─────────────────────────────────────────────────────────────────┘        │
│                                                                              │
│  ┌─ IF APPROVED ───────────────────────────────────────────────────┐        │
│  │  • Status: APPROVED                                             │        │
│  │  • Notify user: "Application approved! Plot [X] assigned."      │        │
│  │  • Proceed to Step 5 (interview scheduling)                     │        │
│  └─────────────────────────────────────────────────────────────────┘        │
└──────────────────────────────────────────────────────────────────────────────┘
                                      │
                                      ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│ STEP 5: MAYOR'S OFFICE - INTERVIEW SCHEDULING                               │
│                                                                              │
│  • Create InterviewSchedule record:                                         │
│    - Application ID                                                         │
│    - Proposed date & time                                                   │
│    - Location                                                               │
│    - Notes/instructions                                                     │
│                                                                              │
│  • Status: FOR_INTERVIEW                                                    │
│  • Notify user: "Interview scheduled for [date] [time] at [location]"       │
└──────────────────────────────────────────────────────────────────────────────┘
                                      │
                                      ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│ STEP 6: MAYOR'S OFFICE - POST-INTERVIEW SCHEDULING                          │
│                                                                              │
│  • After interview conducted:                                               │
│    - Set burial_schedule (date, time, location)                             │
│    - Update InterviewSchedule.completed = True                              │
│                                                                              │
│  • Status: SCHEDULED                                                        │
│  • Notify user: "Burial scheduled for [date] at [time]"                     │
│    (Forward to Cemetery Staff for execution)                                │
└──────────────────────────────────────────────────────────────────────────────┘
                                      │
                                      ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│ STEP 7: CEMETERY STAFF - BURIAL EXECUTION                                    │
│                                                                              │
│  • Execute burial on scheduled date/time                                    │
│  • After burial:                                                            │
│    - Update BurialApplication.status = COMPLETED                            │
│    - Update assigned_plot.status = OCCUPIED                                 │
│    - Record burial_date = today()                                           │
│                                                                              │
│  • Notify user: "Burial completed successfully. Plot [X] record saved."      │
│  • Notify Mayor's Office: "Burial #[app_id] completed"                      │
└──────────────────────────────────────────────────────────────────────────────┘
                                      │
                                      ▼
                               ┌─── END ───┐


================================================================================
KEY RULES ENFORCEMENT
================================================================================

1. NO PAYMENT INVOLVED
   - No billing, no fees, no payment endpoints
   - Public service only

2. NO RESERVATION SYSTEM
   - Users CANNOT manually choose plots
   - Plots are assigned automatically by system

3. NO USER CHOICE
   - Users submit application + documents only
   - System decides plot assignment

4. AUTOMATIC PLOT ALLOCATION
   - First available plot → assigned to user
   - No City Planning manual review needed
   - Plot remains "AVAILABLE" in DB but is reserved

5. ROLE-SPECIFIC RESPONSIBILITIES

   ┌─ PUBLIC USER ─────────────────────────────────────┐
   │ • Submit application                              │
   │ • Upload documents                                │
   │ • Attend interview                                │
   │ • CANNOT see cemetery map or plot details         │
   │ • CANNOT choose plots                             │
   └───────────────────────────────────────────────────┘

   ┌─ MAYOR'S OFFICE ──────────────────────────────────┐
   │ • Review documents (Step 2)                       │
   │ • Approve/Reject application (Step 4)             │
   │ • Schedule interview (Step 5)                     │
   │ • Set burial schedule after interview (Step 6)    │
   │ • Only role that can update application status    │
   │ • Handles ALL decision points                     │
   └───────────────────────────────────────────────────┘

   ┌─ CITY PLANNING ────────────────────────────────────┐
   │ • NO MANUAL ROLE                                  │
   │ • Plot assignment is AUTOMATIC                    │
   │ • Can VIEW dashboard (analytics only)             │
   │ • CANNOT make decisions                           │
   └───────────────────────────────────────────────────┘

   ┌─ CEMETERY STAFF ──────────────────────────────────┐
   │ • View scheduled burials                          │
   │ • Execute burial                                  │
   │ • Mark burial as COMPLETED (Step 7)               │
   │ • Update plot status to OCCUPIED                  │
   │ • CANNOT approve applications                     │
   └───────────────────────────────────────────────────┘


================================================================================
STATUS TRANSITIONS (FINITE STATE MACHINE)
================================================================================

PENDING_REVIEW ──→ ACTION_REQUIRED (documents invalid)
                ──→ SLOT_ASSIGNED (documents valid, auto-assigned)

ACTION_REQUIRED ──→ PENDING_REVIEW (user resubmits documents)

SLOT_ASSIGNED ──→ APPROVED (mayor approves)
               ──→ REJECTED (mayor denies)

APPROVED ──→ FOR_INTERVIEW (mayor schedules interview)

FOR_INTERVIEW ──→ SCHEDULED (mayor schedules burial after interview)

SCHEDULED ──→ COMPLETED (cemetery staff executes)

REJECTED ──→ (END - no further action)

COMPLETED ──→ (END - archived)


================================================================================
NOTIFICATION TARGETS
================================================================================

User Notifications:
- Step 1: "Application received"
- Step 2a: "Documents incomplete" (ACTION_REQUIRED)
- Step 4a: "Application denied" (REJECTED)
- Step 4b: "Application approved + plot assigned" (APPROVED)
- Step 5: "Interview scheduled" (FOR_INTERVIEW)
- Step 6: "Burial scheduled" (SCHEDULED)
- Step 7: "Burial completed" (COMPLETED)

Mayor's Office Notifications:
- Step 1: "New application received"
- Step 2: Decision log entry

Cemetery Staff Notifications:
- Step 6: "New scheduled burial"
- Step 7: Acknowledgment of completion

Public Dashboard:
- Shows: APPROVED, FOR_INTERVIEW, SCHEDULED, COMPLETED only
- Hides: PENDING_REVIEW, ACTION_REQUIRED, REJECTED (privacy)

================================================================================
