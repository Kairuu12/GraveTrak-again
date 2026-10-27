# GraveTrak - Quick Reference Card

## System Overview

```
┌─────────────────────────────────────────────────────────────────┐
│ GRAVETRAK - Cemetery Management GIS System                      │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  Frontend (React)                Backend (Django REST API)       │
│  Port: 5173                      Port: 8000                      │
│  http://localhost:5173/    ←→    http://127.0.0.1:8000/api/    │
│                                                                  │
│  Technology Stack:              Technology Stack:               │
│  - React 18.3.1                 - Django 4.2.30                  │
│  - Vite 5.4.0                   - DRF 3.17.1                     │
│  - Leaflet 1.9.4                - SQLite DB                      │
│  - Tailwind CSS                 - Token Auth                      │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## Startup Commands

### Backend (Terminal 1)
```bash
cd backend/gravetrak_backend
venv\Scripts\activate  # Windows
source venv/bin/activate  # Mac/Linux
python manage.py runserver 127.0.0.1:8000
```

Expected output:
```
Starting development server at http://127.0.0.1:8000/
Quit the server with CTRL-BREAK.
```

### Frontend (Terminal 2)
```bash
cd frontend
npm run dev
```

Expected output:
```
VITE v5.4.0 ready in 123 ms
➜  Local:   http://localhost:5173/
```

---

## Demo Accounts

| Role | Email | Password | Dashboard |
|------|-------|----------|-----------|
| 👥 Public User | user@lgu.gov.ph | userpass | Cemetery map (view only) |
| 🏛️ Cemetery Admin | admin@lgu.gov.ph | adminpass | Full CRUD, columbarium, records |
| 👔 Mayor's Office | mayor@lgu.gov.ph | mayorpass | Applications review |
| 📊 City Planning | planner@lgu.gov.ph | planningpass | Analytics & zoning |

**Quick Demo:** Click the role buttons on login page for instant access.

---

## Error Messages & Quick Fixes

| Error | Cause | Fix |
|-------|-------|-----|
| ❌ Failed to connect to backend | Backend not running | Start backend server on port 8000 |
| ⚠️ Invalid credentials | Wrong password | Check caps lock, use demo buttons |
| ⚠️ Email and password required | Password field empty | Fill password field, try again |
| 🔴 Network timeout | Slow connection | Refresh page, restart servers |
| 🌐 CORS error in console | Config issue | Verify CORS settings in Django |

---

## System Architecture

### Frontend Request Flow
```
Browser Input
    ↓
React Component (useState, useEffect)
    ↓
API Call (src/api.js)
    ↓
Vite Proxy (/api/* → :8000)
    ↓
Django Backend
    ↓
SQLite Database
    ↓
Response → Component Update → UI Render
```

### API Response Structure
```json
{
  "token": "abc123def456",
  "user": {
    "id": 1,
    "email": "admin@lgu.gov.ph",
    "role": "admin"
  }
}
```

---

## File Structure Reference

```
backend/
├── gravetrak_backend/
│   ├── settings.py          ← Django config, CORS, databases
│   ├── urls.py              ← API routes
│   └── manage.py            ← Django CLI
├── api/
│   ├── models.py            ← UserProfile, Grave models
│   ├── serializers.py       ← JSON serializers
│   ├── views.py             ← API endpoints
│   └── apps.py              ← Demo data seeding
└── db.sqlite3               ← Database

frontend/
├── src/
│   ├── App.jsx              ← Main app, auth state
│   ├── api.js               ← Backend communication
│   ├── main.jsx             ← Entry point
│   ├── components/
│   │   ├── AuthScreen.jsx   ← Login/register forms
│   │   ├── AdminPanels.jsx  ← Admin dashboards
│   │   ├── GravePanel.jsx   ← Grave details popup
│   │   └── Sidebar.jsx      ← Navigation menu
│   ├── pages/
│   │   └── PublicMapPage.jsx ← Public cemetery map
│   ├── hooks/
│   │   └── useLeafletMap.jsx ← Map initialization
│   └── data/
│       └── data.js          ← Constant data
├── styles.css               ← Global styles
├── vite.config.js           ← Vite config & proxy
├── package.json             ← Dependencies
└── .env                     ← Environment variables
```

---

## API Endpoints Reference

### Authentication
| Method | Endpoint | Body | Response |
|--------|----------|------|----------|
| POST | /api/login/ | {email, password} | {token, user} |
| POST | /api/register/ | {email, password, first_name, last_name} | {token, user} |
| GET | /api/profile/ | - | {id, email, role, ...} |
| POST | /api/logout/ | - | {detail: "Logged out"} |

### Graves (CRUD)
| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | /api/graves/ | List all graves |
| POST | /api/graves/ | Create grave (admin only) |
| GET | /api/graves/{id}/ | Get grave details |
| PUT | /api/graves/{id}/ | Update grave (admin only) |
| DELETE | /api/graves/{id}/ | Delete grave (admin only) |

---

## Browser DevTools Tips (F12)

### Console Tab
- `[API] Fetching:` = Request sent
- `[API] Success:` = Response received ✓
- `[API Error]` = API error
- `[API Network Error]` = Backend unreachable

### Network Tab
- Green status 200 = Success
- Red status = Error
- Filter by "api/" to see API calls only

### Application Tab
- LocalStorage → "token" = Auth token stored
- Check if token exists after login

---

## Keyboard Shortcuts

| Action | Windows | Mac |
|--------|---------|-----|
| Open DevTools | F12 | Cmd+Option+I |
| Refresh page | Ctrl+R | Cmd+R |
| Hard refresh | Ctrl+Shift+R | Cmd+Shift+R |
| Clear console | Ctrl+L | Cmd+K |
| Stop backend | Ctrl+C | Ctrl+C |
| Quit terminal | Alt+F4 | Cmd+Q |

---

## Performance Metrics

| Operation | Time | Status |
|-----------|------|--------|
| Page load | 1-2s | ✓ Normal |
| Login | 1-3s | ✓ Normal |
| Dashboard switch | 0.5-1s | ✓ Normal |
| Map load | 2-3s | ✓ Normal |
| API call | 200-500ms | ✓ Normal |
| Grave creation | 1-2s | ✓ Normal |

If significantly slower → Check console for errors.

---

## Common Commands

### Stop/Start Services
```bash
# Stop backend
Ctrl+C in backend terminal

# Restart backend (wait 2 seconds)
python manage.py runserver 127.0.0.1:8000

# Stop frontend
Ctrl+C in frontend terminal

# Restart frontend
npm run dev
```

### Database Management
```bash
# Reset database (deletes all data)
cd backend/gravetrak_backend
python manage.py migrate --run-syncdb  # or delete db.sqlite3

# View database shell
python manage.py shell
>>> from api.models import UserProfile
>>> UserProfile.objects.all()
```

### Dependency Management
```bash
# Backend - Install dependencies
pip install -r requirements.txt

# Frontend - Install dependencies
npm install

# Frontend - Update dependencies
npm update
```

---

## Troubleshooting Decision Tree

```
Issue: "Failed to fetch"
├─ Check: Is backend running? (port 8000)
│  ├─ NO → Start backend
│  └─ YES → Check: Any errors in backend terminal?
│     ├─ YES → Fix error, restart backend
│     └─ NO → Check: Console shows [API Network Error]?
│        ├─ YES → Backend crashed, restart it
│        └─ NO → Check: Network tab shows 200 status?
│           ├─ YES → Frontend bug, check frontend terminal
│           └─ NO → Network issue, check firewall/proxy
│
Issue: "Invalid credentials"
├─ Check: Correct email? (admin@lgu.gov.ph)
│  └─ NO → Use correct email
├─ Check: Correct password? (adminpass)
│  └─ NO → Use correct password
├─ Check: Caps lock off?
│  └─ YES (caps on) → Turn off caps lock
└─ NO solution? → Use Quick Demo button instead
│
Issue: Port already in use
├─ Check: What's using port 8000?
│  → netstat -ano | findstr :8000
├─ Kill process:
│  → taskkill /PID <PID> /F
└─ Restart backend
```

---

## Getting Help

Prepare this info:
1. Screenshot of error message
2. Browser console output (F12)
3. Backend & frontend terminal output
4. Exact steps to reproduce
5. Port numbers being used
6. Both servers running? (Yes/No)

---

## Version Info

- Django: 4.2.30
- React: 18.3.1
- Vite: 5.4.0
- Node: 18+
- Python: 3.10+
- Leaflet: 1.9.4
- DRF: 3.17.1

Last updated: 2025-05-04
