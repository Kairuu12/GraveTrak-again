# GraveTrak Capstone - Geospatial Cemetery Management System

A complete full-stack web application for managing cemetery operations, burial applications, plot assignments, and geospatial visualization.

---

## 🏛️ Project Overview

GraveTrak is a comprehensive cemetery management system built with:
- **Frontend**: React + Vite (modern SPA)
- **Backend**: Django REST Framework (robust API)
- **Database**: SQLite (development) / PostgreSQL (production-ready)
- **Maps**: Leaflet.js for geospatial visualization
- **Authentication**: Token-based REST API

### Key Features
- ✅ Burial application submission with document uploads
- ✅ Automatic plot assignment using rule-based logic
- ✅ Interview scheduling and workflow management
- ✅ Role-based access control (Public Users, Admin, Mayor's Office, Cemetery Staff, City Planning)
- ✅ Interactive cemetery map visualization
- ✅ Real-time notifications and status updates
- ✅ Comprehensive audit logging

---

## 📁 Project Structure

```
GraveTrak-Capstone/
├── backend/                          # Django REST API
│   ├── api/                          # Main app (models, views, serializers)
│   ├── gravetrak_backend/            # Django settings & config
│   ├── media/                        # User uploads (burial documents)
│   ├── venv/                         # Python virtual environment
│   ├── manage.py                     # Django management
│   ├── requirements.txt              # Python dependencies
│   └── db.sqlite3                    # Database
│
├── frontend/                         # React + Vite SPA
│   ├── src/
│   │   ├── components/               # React components
│   │   ├── pages/                    # Page components
│   │   ├── hooks/                    # Custom React hooks
│   │   ├── data/                     # Mock data
│   │   ├── api.js                    # API client
│   │   └── main.jsx                  # Entry point
│   ├── package.json
│   ├── vite.config.js
│   ├── index.html
│   └── styles.css
│
├── docs/                             # Documentation
│   ├── SETUP_GUIDE.md                # Installation & setup
│   ├── SYSTEM_FLOW.md                # System architecture
│   ├── STATUS_LIFECYCLE.md           # Application workflow
│   ├── API_ENDPOINTS_REFERENCE.md    # REST API docs
│   ├── SERIALIZERS_REFERENCE.md      # Data serialization
│   ├── PLOT_LOGIC_REFERENCE.md       # Plot assignment logic
│   ├── TROUBLESHOOTING.md            # Common issues
│   └── ...
│
├── scripts/                          # Utility scripts
│   └── temp/                         # Temporary test scripts
│
├── archive/                          # Backups (not in git)
│
├── .gitignore                        # Git ignore rules
└── README.md                         # This file

```

---

## 🚀 Quick Start

### Prerequisites
- Python 3.10+
- Node.js 18+
- npm or yarn

### Installation

#### Backend Setup
```bash
cd backend

# Create virtual environment (if not already done)
python -m venv venv

# Activate virtual environment
# Windows:
venv\Scripts\activate
# macOS/Linux:
source venv/bin/activate

# Install dependencies
pip install -r requirements.txt

# Apply migrations
$env:DJANGO_DEBUG = "1"
$env:DB_ENGINE = "sqlite"
python manage.py migrate

# Create superuser (optional)
python manage.py createsuperuser

# Run development server
python manage.py runserver 127.0.0.1:8000
```

#### Frontend Setup
```bash
cd frontend

# Install dependencies
npm install

# Run development server
npm run dev

# Frontend will be available at http://localhost:5173/
```

### Running Both Servers

Use VS Code tasks or run in separate terminals:

**Terminal 1 (Backend):**
```bash
cd backend
$env:DJANGO_DEBUG = "1"
$env:DB_ENGINE = "sqlite"
venv\Scripts\python.exe manage.py runserver 127.0.0.1:8000
```

**Terminal 2 (Frontend):**
```bash
cd frontend && npm run dev
```

---

## 🔌 API Endpoints

All endpoints require authentication (Token-based).

### Burial Applications
- `POST /api/burial-applications/` - Submit new application
- `GET /api/burial-applications/` - List applications
- `GET /api/burial-applications/{id}/` - Get application details
- `PATCH /api/burial-applications/{id}/` - Update application

### Burial Plots
- `GET /api/burial-plots/` - List all plots
- `GET /api/burial-plots/{id}/` - Get plot details
- `GET /api/burial-plots/map-data/` - Get map visualization data

### Interviews & Scheduling
- `POST /api/interviews/` - Schedule interview
- `GET /api/interviews/` - List interviews
- `PATCH /api/interviews/{id}/` - Update interview status

### System
- `POST /api/auth/token/` - Get authentication token
- `GET /api/status/` - System health check

See [API_ENDPOINTS_REFERENCE.md](docs/API_ENDPOINTS_REFERENCE.md) for complete documentation.

---

## 🔐 Authentication

The system uses Token-based Authentication (Django REST Framework).

### Getting an Auth Token
```bash
# Via API
curl -X POST http://127.0.0.1:8000/api/auth/token/ \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"password"}'
```

### Using Token in Requests
```bash
curl http://127.0.0.1:8000/api/burial-applications/ \
  -H "Authorization: Token YOUR_TOKEN_HERE"
```

---

## 👥 User Roles

- **Public User**: Submit burial applications, track application status
- **Cemetery Staff**: Manage plots, verify documents, schedule burials
- **Mayor's Office**: Approve/reject applications
- **City Planning**: View-only access to cemetery data
- **Cemetery Staff**: Full system access

---

## 📚 Documentation

Complete documentation available in `docs/` folder:

| Document | Purpose |
|----------|---------|
| [SETUP_GUIDE.md](docs/SETUP_GUIDE.md) | Installation & configuration |
| [SYSTEM_FLOW.md](docs/SYSTEM_FLOW.md) | Architecture & system design |
| [STATUS_LIFECYCLE.md](docs/STATUS_LIFECYCLE.md) | Application workflow states |
| [API_ENDPOINTS_REFERENCE.md](docs/API_ENDPOINTS_REFERENCE.md) | REST API documentation |
| [SERIALIZERS_REFERENCE.md](docs/SERIALIZERS_REFERENCE.md) | Data structure reference |
| [PLOT_LOGIC_REFERENCE.md](docs/PLOT_LOGIC_REFERENCE.md) | Automatic plot assignment |
| [TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md) | Common issues & solutions |

---

## 🔧 Development

### Frontend Build
```bash
cd frontend
npm run build        # Production build
npm run preview      # Preview production build
```

### Backend Management
```powershell
cd backend
$env:DJANGO_DEBUG = "1"
$env:DB_ENGINE = "sqlite"
python manage.py makemigrations    # Create migrations
python manage.py migrate           # Apply migrations
python manage.py createsuperuser   # Create admin user
python manage.py collectstatic     # Collect static files
```

### Database

**Current**: SQLite (`db.sqlite3`)

**To select PostgreSQL**:
Set `DB_ENGINE=postgresql` and provide `DB_NAME`, `DB_USER`, `DB_PASSWORD`,
`DB_HOST`, and optionally `DB_PORT` (default `5432`) in the backend process
environment. Django does not load `.env` files automatically; `backend/.env.example`
is a reference. For Render, set these values in the backend service environment.
`DJANGO_DEBUG` defaults to `0`, so PostgreSQL is the default and missing
credentials cause startup to fail instead of falling back to SQLite. For local
SQLite use `DB_ENGINE=sqlite` or set `DJANGO_DEBUG=1`.

Switching database engines does not copy records. Keep `backend/db.sqlite3` and
`backend/media` unchanged as rollback sources until any separately approved
data transfer has been completed and verified. Do not apply migrations to the
production database before it has been prepared and backed up.

---

## 🗂️ Temporary Scripts

Utility scripts for development are located in `scripts/temp/`:
- `get_token.bat` / `get_token.py` - Get authentication token
- `repro_api.bat` / `repro_api.py` - Reproduce/test API calls

---

## 📋 Deployment Checklist

- [ ] Set `DEBUG = False` in settings
- [ ] Update `ALLOWED_HOSTS` with production domain
- [ ] Set `DJANGO_SECRET_KEY` environment variable
- [ ] Use PostgreSQL instead of SQLite
- [ ] Configure CORS for frontend domain
- [ ] Set up HTTPS/SSL
- [ ] Configure email for notifications
- [ ] Set up backup strategy for media files
- [ ] Configure logging and monitoring

---

## 🤝 Contributing

When making changes:
1. Create a branch for your feature
2. Follow existing code style
3. Test thoroughly before submitting
4. Update documentation as needed
5. Ensure all imports and API calls still work

---

## 📄 License

This is a capstone project for educational purposes.

---

## 📞 Support

For issues or questions:
1. Check [TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md)
2. Review [SETUP_GUIDE.md](docs/SETUP_GUIDE.md)
3. Check backend/api/views.py and frontend/src/api.js for implementation details

---

## 📝 Project Status

- ✅ Backend API: Production-ready
- ✅ Frontend SPA: Production-ready
- ✅ Authentication: Complete
- ✅ Plot Assignment Logic: Automated
- ✅ Document Management: Complete
- ⚠️ Testing: In progress
- ⚠️ Deployment: Not yet configured

---

**Last Updated**: May 7, 2026  
**Version**: 1.0.0
