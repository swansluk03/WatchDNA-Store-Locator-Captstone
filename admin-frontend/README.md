# WatchDNA Admin Panel - Frontend

React-based admin panel for managing CSV uploads, validating store locations, and monitoring data scraper jobs.

## Features

- User authentication with JWT tokens
- Dashboard with upload statistics
- CSV upload management
- Validation log viewer
- Upload detail pages with error/warning tracking
- Protected routes with role-based access

## Tech Stack

- React 19
- TypeScript
- Vite
- React Router v6
- Axios
- CSS Modules

## Project Structure

```
admin-frontend/
├── src/
│   ├── components/      # Reusable UI components
│   ├── contexts/        # React Context (Auth)
│   ├── pages/           # Page components
│   ├── services/        # API client
│   └── styles/          # CSS files
├── public/              # Static assets
└── index.html           # Entry HTML
```

## Prerequisites

- Node.js 18+ and npm
- Backend server running on `http://localhost:3001` (see [../backend/README.md](../backend/README.md))

## Setup

### 1. Install Dependencies

```bash
npm install
```

### 2. Configure API URL (Optional)

By default, the frontend connects to `http://localhost:3001`.

For production or custom backend URL, create a `.env` file:

```bash
VITE_API_URL=http://localhost:3001
```

### 3. Start Development Server

```bash
npm run dev
```

The app will start on `http://localhost:5173`

### 4. Login

Open `http://localhost:5173` in your browser.

**Default Credentials:**
- Username: `admin`
- Password: `admin123`

**Note:** Make sure the backend server is running before attempting to login!

## Available Scripts

- `npm run dev` - Start development server with hot reload
- `npm run build` - Build for production
- `npm run preview` - Preview production build locally
- `npm run lint` - Run ESLint

## Pages

### Login (`/login`)
- Username/password authentication
- JWT token storage in localStorage
- Auto-redirect to dashboard on success

### Dashboard (`/`)
- Upload statistics (total, valid, invalid, locations)
- Recent uploads list
- Quick upload button

### Uploads (`/uploads`)
- Paginated list of all CSV uploads
- Status indicators (pending, valid, invalid, processing)
- Search and filter functionality
- Delete uploads

### Upload Detail (`/uploads/:id`)
- Upload metadata
- Validation summary
- Error and warning logs
- Row-by-row validation details

## Authentication Flow

1. User enters credentials on `/login`
2. Frontend sends POST to `/api/auth/login`
3. Backend returns JWT token and user info
4. Token stored in `localStorage`
5. Token attached to all API requests via Axios interceptor
6. Protected routes check `isAuthenticated` before rendering
7. 401 responses auto-redirect to login

## API Integration

The frontend uses Axios with interceptors for:
- **Request Interceptor**: Attaches JWT token to Authorization header
- **Response Interceptor**: Handles 401 errors and redirects to login

See [src/services/api.ts](src/services/api.ts) for implementation.

## Protected Routes

All routes except `/login` require authentication:
- Unauthenticated users are redirected to `/login`
- Authentication state managed via React Context
- Token validated on mount from localStorage

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `VITE_API_URL` | `http://localhost:3001` | Backend API base URL |

## Development

### Adding a New Page

1. Create component in `src/pages/`
2. Add route in `src/App.tsx`
3. Wrap in `<ProtectedRoute>` if auth required
4. Add navigation link in `src/components/Layout.tsx`

### Calling Backend APIs

```typescript
import api from '../services/api';

// GET request
const response = await api.get('/uploads');

// POST request
const response = await api.post('/uploads', formData);

// Token is automatically attached by interceptor
```

## Styling

- Global styles in `src/styles/App.css`
- Component-specific styles can be added as CSS modules or inline

## Production Build

```bash
npm run build
```

Output in `dist/` directory. Serve with any static file server:

```bash
npm run preview
```

## Troubleshooting

### Can't Login / API Errors

**Check backend is running:**
```bash
curl http://localhost:3001/health
```

Should return:
```json
{
  "status": "ok",
  "timestamp": "...",
  "service": "WatchDNA Admin Backend"
}
```

**Check browser console** for network errors (F12 → Console tab)

### Stuck on Loading Screen

Clear localStorage and refresh:
```javascript
// In browser console (F12)
localStorage.clear()
location.reload()
```

### CORS Errors

Backend must have CORS enabled for frontend origin. The backend already includes:
```typescript
app.use(cors());
```

If using a different port/domain, update backend CORS config.

### Port 5173 Already in Use

Vite will automatically try the next available port. Or specify a custom port:

```bash
npm run dev -- --port 3000
```

## Next Steps

- [ ] Add user management UI (create/edit/delete users)
- [ ] Add CSV export functionality
- [ ] Add scraper job monitoring
- [ ] Add location map view
- [ ] Add dark mode toggle
- [ ] Add pagination controls for large datasets

## Contributing

This is part of the WatchDNA Store Locator capstone project.

For backend setup, see [../backend/README.md](../backend/README.md)
