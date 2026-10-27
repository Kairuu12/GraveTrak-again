# GraveTrak v2.0 - Cemetery Management System

A modern, geospatial cemetery management system with separate pages for different user roles and functionalities.

## Project Structure

### Main Entry Point
- **`index.html`** - Main application entry point with iframe-based navigation system

### Page Components
- **`auth.html`** - Authentication and login page
- **`public.html`** - Public dashboard with cemetery map and information
- **`admin.html`** - Admin dashboard with full management capabilities

### Shared Resources
- **`styles.css`** - Global CSS styles and design tokens
- **`script.js`** - Shared JavaScript functions and data

## Architecture

The application uses an iframe-based navigation system where:

1. **`index.html`** serves as the main container and navigation controller
2. Individual pages (`auth.html`, `public.html`, `admin.html`) are loaded in an iframe
3. Pages communicate with the parent window via `postMessage` API for navigation
4. URL parameters control initial page loading and user state

## Navigation Flow

```
index.html (Main Container)
├── auth.html (Login/Register)
├── public.html (Public Map View)
└── admin.html (Admin Dashboard)
```

## User Roles

- **Public User**: Access to cemetery map, search, and basic information
- **Admin**: Full cemetery management, grave records, approvals
- **Mayor**: Executive dashboard with high-level metrics
- **Planning**: Spatial analytics and capacity planning

## Getting Started

1. Start a local web server:
   ```bash
   python -m http.server 8000
   ```

2. Open `http://localhost:8000/index.html` in your browser

3. Use the demo login buttons or navigate between pages

## URL Parameters

- `?page=auth` - Load authentication page
- `?page=public` - Load public dashboard
- `?page=admin&role=admin` - Load admin dashboard
- `?role=user` - Set user role for public access

## Features

- **Interactive Maps**: Leaflet-powered cemetery visualization
- **Role-based Access**: Different interfaces for different user types
- **Responsive Design**: Works on desktop and mobile devices
- **Modern UI**: Glassmorphism design with smooth animations
- **Real-time Navigation**: Seamless page transitions without full reloads

## Technologies Used

- **HTML5** - Semantic markup and structure
- **CSS3** - Modern styling with CSS Grid and Flexbox
- **JavaScript (ES6+)** - Interactive functionality
- **Leaflet.js** - Interactive maps and geospatial data
- **Iframe Navigation** - Multi-page application architecture