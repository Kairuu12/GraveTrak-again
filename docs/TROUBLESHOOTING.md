# GraveTrak - Troubleshooting Guide

## Quick Checklist Before Reporting Issues

### 1. Verify Both Servers Are Running

**Backend Server (Django):**
- Terminal should show: `Starting development server at http://127.0.0.1:8000/`
- No errors or warnings displayed

**Frontend Server (Vite):**
- Terminal should show: `Local: http://localhost:5173/`
- No build errors or warnings

**Both servers must be running simultaneously** for the application to work.

---

## Error: "Failed to connect to backend server"

### When You See This
- Login page appears but login fails
- You see a red error box: "⚠ Failed to connect to backend server. Make sure the server is running at http://127.0.0.1:8000"

### Common Causes & Solutions

#### 1. Backend server is NOT running
**Check:**
```bash
# In PowerShell, check if port 8000 is listening
netstat -ano | findstr :8000

# Expected output: Multiple lines showing processes on port 8000
```

**Fix:**
1. Open a new terminal/PowerShell
2. Navigate to: `backend/gravetrak_backend`
3. Activate venv: `venv\Scripts\activate`
4. Run: `python manage.py runserver 127.0.0.1:8000`
5. Wait for: `Starting development server at http://127.0.0.1:8000/`
6. Refresh browser (F5 or Ctrl+R)
7. Try login again

#### 2. Backend running on wrong port
**Check:**
- Verify your backend terminal says: `http://127.0.0.1:8000`
- NOT `http://127.0.0.1:8080` or any other port

**Fix:**
```bash
# Explicitly specify port 8000
python manage.py runserver 127.0.0.1:8000
```

#### 3. Port 8000 is already in use (by another program)
**Check:**
```powershell
netstat -ano | findstr :8000
```

**Fix:**
```powershell
# Get the Process ID (PID) from the netstat output
# Then kill it:
taskkill /PID <PID> /F

# Example:
taskkill /PID 12345 /F

# Then start Django again
python manage.py runserver 127.0.0.1:8000
```

#### 4. Firewall blocking localhost connections
**Less Common, but:**
- Check Windows Firewall settings
- Allow Python through firewall
- Or temporarily disable firewall to test

---

## Error: "Email and password are required"

### When You See This
- You clicked "Sign In" but password field is empty
- Error shows: "⚠ Email and password are required."

### Solution
Simply fill in the password field and try again:
1. Click in Password field
2. Type password (e.g., `adminpass`)
3. Click "Sign In"

**Tip:** Use the Quick Demo buttons at the bottom for instant login without typing.

---

## Error: "Invalid credentials"

### When You See This
- Email and password are filled
- Error shows: "⚠ Invalid credentials"

### Solution
1. **Verify correct credentials:**
   ```
   Cemetery Admin:
   Email: admin@lgu.gov.ph
   Password: adminpass
   ```

2. **Check capitalization:**
   - Email is case-insensitive
   - Password IS case-sensitive

3. **Use Quick Demo buttons:**
   - Click "Cemetery Staff" button
   - Bypasses need to type password

4. **If all else fails, restart backend:**
   - Backend seeds demo users on startup
   - Kill backend: `Ctrl+C` in backend terminal
   - Wait 2 seconds
   - Run: `python manage.py runserver 127.0.0.1:8000`

---

## Testing Backend API Directly

If login fails but you want to verify backend is responding:

### Test 1: Check if backend is listening
```powershell
Invoke-WebRequest -Uri "http://127.0.0.1:8000/" | Select-Object StatusCode
```
Expected: `200`

### Test 2: Check if API endpoint exists
```powershell
Invoke-WebRequest -Uri "http://127.0.0.1:8000/api/graves/" | Select-Object StatusCode
```
Expected: `200`

### Test 3: Try login via API directly
```powershell
$loginData = @{
    email = "admin@lgu.gov.ph"
    password = "adminpass"
} | ConvertTo-Json

Invoke-WebRequest `
  -Uri "http://127.0.0.1:8000/api/login/" `
  -Method Post `
  -ContentType "application/json" `
  -Body $loginData
```

Expected Response:
```json
{
    "token": "abc123...",
    "user": {
        "id": 1,
        "email": "admin@lgu.gov.ph",
        "role": "admin"
    }
}
```

If this works, backend is fine - problem is in frontend/proxy.

---

## Debugging in Browser

### Open Developer Tools
Press **F12** in browser, then check these tabs:

#### Network Tab
1. Click "Network" tab
2. Try to login
3. Look for requests to `/api/login/`
4. Click on the request
5. Check:
   - **Status**: Should be `200` (green) for success
   - **Response**: Should show token and user data
   - **Headers**: Should show `Authorization: Token abc123...`

**Common Network Issues:**
- Red X mark = Request blocked or failed
- `POST /api/login/` with Status `0` = Backend not responding
- `CORS error in console` = Backend CORS configuration issue

#### Console Tab
1. Click "Console" tab
2. Try to login
3. Look for these messages:
   - `[API] Fetching: http://127.0.0.1:8000/api/login/` = Request sent ✓
   - `[API] Success: http://127.0.0.1:8000/api/login/` = Success ✓
   - `[API Error]` = API returned an error
   - `[API Network Error] Failed to connect...` = Backend unreachable ✗

**Capture Console Output:**
If you see errors, take a screenshot of the console and share with support.

---

## Complete System Status Verification

Run this verification checklist to diagnose any issues:

### Step 1: Check Backend
```powershell
# 1. Verify process is listening
netstat -ano | findstr :8000
# Should show: ONE OR MORE lines with port 8000 in LISTEN state

# 2. Test API response
Invoke-WebRequest -Uri "http://127.0.0.1:8000/" | Select-Object StatusCode
# Should show: 200

# 3. Check for errors in backend terminal
# Backend terminal should NOT show any red error text
```

### Step 2: Check Frontend
```powershell
# 1. Frontend should be running
# Terminal should show: "Local: http://localhost:5173/"

# 2. Can you see the login page?
# Go to http://localhost:5173/ in browser
# Should see: GraveTrak logo, Email field, Password field, Sign In button
```

### Step 3: Test Login
1. In browser, go to http://localhost:5173/
2. Try one of the Quick Demo buttons
3. Should instantly login and show dashboard

### Step 4: Check Console
1. Press F12 in browser
2. Click "Console" tab
3. Click Sign In button (or demo button)
4. Look for `[API]` messages
5. Should see success messages, NOT error messages

---

## Advanced Debugging

### If you still have issues, collect this information:

1. **Backend Terminal Output:**
   - Copy/paste last 20 lines from backend terminal

2. **Frontend Terminal Output:**
   - Copy/paste last 20 lines from frontend terminal

3. **Browser Console Output:**
   - Press F12 → Console tab
   - Copy all `[API]` messages
   - Copy any error messages

4. **Network Tab Logs:**
   - Press F12 → Network tab
   - Try to login
   - Right-click → Copy all as HAR
   - Or take screenshot of failed request

5. **Verify Environment:**
   - Backend running at: `http://127.0.0.1:8000/`
   - Frontend running at: `http://localhost:5173/`
   - Both ports are correct? (Not 8080, 5000, etc.)

---

## Common Scenarios

### Scenario 1: First Time Setup
```bash
# Terminal 1 - Backend
cd backend/gravetrak_backend
venv\Scripts\activate
python manage.py runserver 127.0.0.1:8000

# Terminal 2 - Frontend
cd frontend
npm run dev

# Browser
Go to http://localhost:5173/
```

Expected: Login page loads, quick demo buttons work.

### Scenario 2: Backend Crashes
**Symptom:** Was working, then suddenly "Failed to connect"

**Fix:**
1. Backend terminal shows error
2. Kill backend: `Ctrl+C`
3. Restart: `python manage.py runserver 127.0.0.1:8000`
4. Refresh browser: `Ctrl+R`

### Scenario 3: Port Conflict
**Symptom:** "Port 8000 already in use" error

**Fix:**
```powershell
netstat -ano | findstr :8000
# Find the PID (e.g., 12345)
taskkill /PID 12345 /F
# Then restart Django
```

### Scenario 4: CORS Error
**Symptom:** Network tab shows 200 status but console has CORS error

**Check:** Backend has correct CORS configuration
```python
# In backend/gravetrak_backend/settings.py:
CORS_ALLOWED_ORIGINS = [
    "http://127.0.0.1:5173",
    "http://localhost:5173",
    "http://127.0.0.1:3000",
    "http://localhost:3000",
]
```

---

## Performance Notes

| Action | Expected Time |
|--------|----------------|
| Page load | 1-2 seconds |
| Login (first time) | 1-3 seconds |
| Dashboard view switch | 0.5-1 second |
| Map loading | 2-3 seconds |
| API call (graves list) | 200-500ms |

If any of these take significantly longer:
1. Check network tab (F12)
2. Check browser console for errors
3. Verify backend is not hitting errors

---

## Getting Help

When reporting an issue, include:
1. What you were doing when error occurred
2. The exact error message shown
3. Browser console output (F12)
4. Backend and frontend terminal outputs
5. Port numbers being used
6. Whether both servers are actually running

This information will help diagnose 95% of issues quickly.
