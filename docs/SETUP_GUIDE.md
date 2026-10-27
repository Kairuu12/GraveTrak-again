# GraveTrak - Complete Setup Guide

## Quick Start

### Prerequisites
- Python 3.10+ installed
- Node.js 18+ installed
- Two terminal windows/tabs

---

## Backend Setup (Django)

### Step 1: Navigate to backend folder
```bash
cd backend
```

### Step 2: Create and activate virtual environment (if not already done)
```bash
# Create virtual environment
python -m venv venv

# Activate virtual environment
# On Windows:
venv\Scripts\activate

# On macOS/Linux:
source venv/bin/activate
```

### Step 3: Install dependencies
```bash
pip install -r requirements.txt
```

### Step 4: Run migrations (if needed)
```powershell
$env:DJANGO_DEBUG = "1"
$env:DB_ENGINE = "sqlite"
python manage.py migrate
```

### Step 5: Start Django server
```bash
python manage.py runserver 127.0.0.1:8000
```

✅ Backend is ready when you see:
```
Starting development server at http://127.0.0.1:8000/
Quit the server with CTRL-BREAK.
```

---

## Frontend Setup (React + Vite)

### Step 1: Open a NEW terminal window/tab

### Step 2: Navigate to frontend folder
```bash
cd frontend
```

### Step 3: Install dependencies (if needed)
```bash
npm install
```

### Step 4: Start development server
```bash
npm run dev
```

✅ Frontend is ready when you see:
```
VITE v5.4.0 ready in 123 ms
➜  Local:   http://localhost:5173/
➜  press h to show help
```

---

## Demo Accounts

Once both servers are running, access the app at: **http://localhost:5173/**

### Pre-seeded Users:
| Role | Email | Password | Access |
|------|-------|----------|--------|
| Public User | user@lgu.gov.ph | userpass | Public cemetery map |
| Cemetery Staff | admin@lgu.gov.ph | adminpass | Full CRUD, columbarium, grave records |
| Mayor's Office | mayor@lgu.gov.ph | mayorpass | Applications review |
| City Planning | planner@lgu.gov.ph | planningpass | Analytics & records |

### Quick Demo Buttons:
The login page has quick access buttons for all 4 roles - just click them to login instantly.

---

## Troubleshooting

### Error: "Failed to connect to backend server"
**Cause:** Backend Django server is not running

**Solution:**
1. Open a terminal window
2. Navigate to: `backend/gravetrak_backend`
3. Activate virtual environment: `venv\Scripts\activate` (Windows)
4. Run: `python manage.py runserver 127.0.0.1:8000`
5. You should see: `Starting development server at http://127.0.0.1:8000/`
6. Refresh the browser page at http://localhost:5173/

### Error: "Failed to fetch" during login
**Cause:** Usually one of:
- Backend server crashed or stopped
- Network connectivity issue
- Port conflict

**Solution:**
1. Check if backend terminal shows any errors
2. Verify both servers are running (see checklist below)
3. Restart the backend server
4. Clear browser cache (Ctrl+Shift+Delete) and refresh (Ctrl+R)

### Port Already in Use
**Backend (8000):**
```bash
# Find what's using port 8000
netstat -ano | findstr :8000

# Kill the process (if needed)
taskkill /PID <PID> /F
```

**Frontend (5173):**
The Vite dev server will automatically use the next available port if 5173 is taken.

---

## Server Status Checklist

Before testing, verify:

- [ ] Backend terminal shows: `Starting development server at http://127.0.0.1:8000/`
- [ ] Frontend terminal shows: `Local: http://localhost:5173/`
- [ ] Both terminals are NOT showing errors
- [ ] You can access http://localhost:5173/ in browser
- [ ] Login page loads without "Failed to fetch" error

If any are missing, the user will see errors.

---

## API Endpoints (Reference)

All API calls go through the proxy: `/api/*` → `http://127.0.0.1:8000/`

| Method | Endpoint | Purpose |
|--------|----------|---------|
| POST | `/api/login/` | User login (email + password) |
| POST | `/api/register/` | User registration |
| GET | `/api/profile/` | Get logged-in user profile |
| POST | `/api/logout/` | User logout |
| GET | `/api/graves/` | List all grave records |
| POST | `/api/graves/` | Create new grave |
| GET | `/api/graves/{id}/` | Get grave details |
| PUT | `/api/graves/{id}/` | Update grave |
| DELETE | `/api/graves/{id}/` | Delete grave |

---

## Network Flow

```
Browser (localhost:5173)
    ↓
Vite Proxy (/api/* → http://127.0.0.1:8000)
    ↓
Django Backend (127.0.0.1:8000)
    ↓
SQLite Database (db.sqlite3)
```

The proxy handles CORS automatically, so no special configuration is needed.

---

## Common Commands

```bash
# Backend - from backend/gravetrak_backend folder:
python manage.py runserver 127.0.0.1:8000          # Start server
python manage.py migrate                            # Apply migrations
python manage.py shell                              # Django shell

# Frontend - from frontend folder:
npm run dev                                         # Start dev server
npm run build                                       # Build for production
npm run preview                                     # Preview production build
```

---

## Still Having Issues?

1. **Check both terminals** - Do you see any error messages?
2. **Check port conflicts** - Is something else using 8000 or 5173?
3. **Clear cache** - In browser DevTools (F12) → Network tab → Disable cache, then refresh
4. **Restart servers** - Sometimes a fresh restart fixes hanging connections
5. **Check .env files** - Verify `VITE_API_BASE=http://127.0.0.1:8000/api` is set

---

## Browser DevTools Tips

Press **F12** to open DevTools:

1. **Network Tab** - See all API requests
   - Click a request to see method, status, headers
   - Look for red X marks indicating failed requests

2. **Console Tab** - See application logs
   - `[API]` prefix = successful request
   - `[API Error]` prefix = API error response
   - `[API Network Error]` prefix = backend unreachable

3. **Application Tab** - Check stored data
   - LocalStorage → Look for `token` (confirms login)
   - Cookies → Check if any session data present

---

## Performance Notes

- **First Load:** May take 5-10 seconds for React to compile
- **Map Loading:** Cemetery map with 6 grave markers should load in 2-3 seconds
- **API Responses:** All endpoints respond within 200-500ms

If any of these are slower, check:
- Browser console for errors (F12)
- Backend terminal for slow queries
- Network tab for hung requests
