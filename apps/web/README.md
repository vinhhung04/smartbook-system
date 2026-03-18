# SmartBook UI - Frontend Application

Modern, responsive React + TypeScript frontend for SmartBook Inventory Management System with premium UI components using Radix UI, Tailwind CSS, and advanced animations.

## 🚀 Quick Start

```bash
# Install dependencies
npm install

# Development server (http://localhost:5173)
npm run dev

# Production build
npm run build

# ESLint check
npm run lint
```

## 📋 Technology Stack

- **React 18.3.1** - UI library with TypeScript
- **Vite 6.3** - Lightning-fast build tool & dev server
- **TypeScript 5.3** - Type-safe development
- **Tailwind CSS 4.1** - Utility-first CSS
- **Radix UI** - Accessible component primitives (46 components)
- **React Router 7.13** - Client-side routing
- **Axios** - HTTP client with JWT interceptors
- **React Hook Form** - Form state management
- **Recharts** - Data visualization
- **Motion/Framer Motion** - Smooth animations
- **Sonner** - Toast notifications
- **Lucide React** - Icon library

## 📁 Project Structure

```
src/
├── app/
│   ├── App.tsx          # Root component with routing
│   └── routes.ts        # Route definitions (16 pages)
├── components/
│   ├── ui/              # 46 reusable UI components
│   ├── pages/           # 16 feature pages
│   ├── layout.tsx       # Main layout wrapper
│   ├── sidebar.tsx      # Navigation sidebar
│   └── topbar.tsx       # Header bar
├── services/            # API layer
│   ├── api.ts           # Axios client & interceptors
│   ├── auth.ts          # Authentication APIs
│   ├── book.ts          # Book management
│   ├── warehouse.ts     # Warehouse operations
│   ├── stock-movement.ts
│   ├── goods-receipt.ts
│   ├── ai.ts            # AI & OCR services
│   ├── user.ts          # User management
│   └── role.ts          # Role management
├── styles/
│   └── index.css        # Global styles & theme
└── main.tsx             # Entry point
```

## 🎨 Features

### UI Components (46)
Layout, Form, Display, Navigation, Dialog, Advanced components all with full TypeScript support and accessibility.

### Pages (16)
- **Dashboard** - KPIs, charts, alerts
- **Catalog** - Book management with search/filters
- **Inventory** - Stock tracking & health metrics  
- **Orders** - Goods receipts with barcode scanning
- **Movements** - Stock movement history
- **Warehouses** - Warehouse structure management
- **AI Features** - Image analysis & recommendations
- **Administration** - Users, roles, permissions
- **Authentication** - Login & registration

## 🔌 API Integration

All API calls go through centralized services in `/src/services/`:

```typescript
// Example: Fetch books
import { bookService } from '@/services';
const books = await bookService.getAll();
```

**JWT Authentication**: Tokens are automatically stored and included in all requests via Axios interceptors.

## 🐳 Docker

**Multi-stage Build**:
- `development` - Development server with hot reload
- `production` - Optimized static build with serve

```bash
# Build for development
docker build --target development -t smartbook-ui:dev .

# Build for production
docker build --target production -t smartbook-ui:latest .

# With docker-compose
docker-compose up --build smartbook-ui
```

**Environment Variables** (set in docker-compose.yml or .env):
```env
VITE_API_BASE_URL=http://inventory-service:3001        # Or localhost:3003
VITE_AUTH_BASE_URL=http://auth-service:3002            # Or localhost:3004
VITE_AI_BASE_URL=http://ai-service:8000                # Or localhost:8000
```

## 🔧 Configuration

- **TypeScript**: `tsconfig.json` - Strict mode enabled
- **Tailwind**: `tailwind.config.ts` - Custom color tokens
- **Vite**: `vite.config.ts` - @ alias to src/
- **ESLint**: `eslint.config.js` - React & TypeScript rules

## ✅ Quality

- Type-safe with TypeScript strict mode
- ESLint configured for React & TS
- Responsive design (640px to 1440px+)
- WCAG accessibility standards
- Optimized production builds (~200KB gzipped)

## 🔐 Security

- JWT token management
- CORS-aware API configuration
- Input validation with React Hook Form
- XSS protection via React

---

For full documentation, see project README in root directory.
**Last Updated**: March 2026 | **Version**: 1.0.0
# React + Vite

This template provides a minimal setup to get React working in Vite with HMR and some ESLint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Babel](https://babeljs.io/) (or [oxc](https://oxc.rs) when used in [rolldown-vite](https://vite.dev/guide/rolldown)) for Fast Refresh
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/) for Fast Refresh

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the ESLint configuration

If you are developing a production application, we recommend using TypeScript with type-aware lint rules enabled. Check out the [TS template](https://github.com/vitejs/vite/tree/main/packages/create-vite/template-react-ts) for information on how to integrate TypeScript and [`typescript-eslint`](https://typescript-eslint.io) in your project.
