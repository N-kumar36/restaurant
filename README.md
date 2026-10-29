# Saffron & Ember — Restaurant Portfolio + QR Digital Menu + Online Food Ordering

A production-ready, full-stack restaurant platform combining a luxury portfolio website with a contactless table QR digital menu and real-time kitchen order management system.

---

## 🌟 Key Features

### 1. Restaurant Portfolio Website
- **Appetizing Design System**: Warm restaurant palette (`stone-950` dark aesthetic, `amber-400` highlights, elegant typography, subtle animations).
- **Comprehensive Public Pages**:
  - `Home`: Full-width hero, culinary philosophy, signature dish showcase, guest ratings, location highlights.
  - `About Us`: Hearth wood-fire heritage, Executive Chef spotlight, farm-to-table sourcing.
  - `A La Carte Menu Preview`: Category-filtered dishes, allergens, and dietary tags.
  - `Food Gallery`: Curated photography with category filter (Ambience, Food, Hearth, Bar).
  - `Location & Opening Hours`: Full weekly schedule, parking/valet details, directions.
  - `Customer Reviews`: Live testimonials and interactive review submission directly integrated with backend API.
  - `Contact Us`: Concierge reservation and private event booking.
  - `Privacy Policy` & `Terms and Conditions`: Complete compliance documentation.

### 2. QR-Based Mobile Digital Menu & Food Ordering
- **Table Verification**: Validates table tokens from QR URLs (e.g., `/menu/saffron-ember?table=T-01`) against the MySQL database.
- **Dynamic Category Filtering**: Starters, Signature Mains, Breads & Rice, Desserts, Beverages.
- **Dietary & Veg Filters**: Green/Red dietary markers, chef badges, allergen labels.
- **Portion Customization**: Dynamic variants, add-on selections, and cooking notes with real-time price updates.
- **Persistent Cart**: Preserves cart selections across page refreshes via `localStorage`.
- **Authoritative Server Calculations**: Integer-safe decimal arithmetic (cents/paise) to eliminate floating-point calculation drift.
- **Idempotency Protection**: Unique idempotency tokens to prevent duplicate payment and order submissions.

### 3. Real-Time Order Management (Kitchen Display System)
- **Live WebSocket Synchronization**: Socket.IO channels (`restaurant:<id>` and `order:<id>`) for real-time status updates without manual polling.
- **Enforced Lifecycle Transitions**:
  `PENDING` ➔ `ACCEPTED` ➔ `PREPARING` ➔ `READY` ➔ `SERVED` ➔ `COMPLETED` (or `CANCELLED`).
- **Customer Order Tracking View**: Real-time progress bar at `/orders/[orderId]`.

### 4. Admin Management Dashboard
- **Overview Analytics**: Today's sales, active orders, preparation queue, and celebrated dishes.
- **Menu Management**: Add new dishes, configure base prices, and toggle **"Sold Out / In Stock"** with one click.
- **Table & QR Management**: Generate unique QR codes for dining tables with download and print capabilities.
- **Reports & CSV Export**: Export historical order data directly to CSV.
- **Bistro Settings**: Toggle live kitchen operating status, adjust GST % and service charge %.

---

## 🛠️ Technology Stack

| Layer | Technologies |
|---|---|
| **Frontend** | Next.js 16 (App Router), TypeScript (Strict), Tailwind CSS v4, Lucide React, React Hook Form, Zod |
| **Backend** | Node.js, Express.js (ESM), TypeScript, REST API, Socket.IO, Helmet, Morgan, Rate Limiting |
| **Database** | MySQL 8.0, Prisma ORM (with Decimal 10,2 for monetary safety) |
| **Payments** | Razorpay integration with server-side HMAC SHA256 signature verification |
| **Containerization** | Docker, Docker Compose |

---

## 📁 Repository Structure

```
restaurant/
├── backend/
│   ├── prisma/
│   │   ├── schema.prisma       # Relational models & indexes
│   │   └── seed.ts             # Seed data with categories, dishes, tables & QR codes
│   ├── src/
│   │   ├── config/             # DB client, typed environment variables
│   │   ├── middleware/         # Auth, Role guards, Rate limiters, Error handler
│   │   ├── routes/
│   │   │   ├── authRoutes.ts   # Login, Logout, /me
│   │   │   ├── publicRoutes.ts # Restaurant profile, menu, table validation, reviews
│   │   │   ├── orderRoutes.ts  # Authoritative order placement, customer tracking, cancel
│   │   │   ├── paymentRoutes.ts# Razorpay create & HMAC verify
│   │   │   └── adminRoutes.ts  # KDS, menu CRUD, tables, reports, CSV export
│   │   ├── services/           # Socket.IO broadcasting & rooms
│   │   ├── tests/              # Automated test suite (6 tests passing)
│   │   ├── utils/              # Decimal-safe math, JWT helpers
│   │   ├── app.ts              # Express configuration
│   │   └── server.ts           # HTTP & Socket.IO initialization
│   ├── Dockerfile
│   └── package.json
│
├── portfolio-qrbase/           # Next.js App Router Frontend
│   ├── app/
│   │   ├── layout.tsx          # Root layout with Providers & Navbar/Footer
│   │   ├── page.tsx            # Restaurant Portfolio Homepage
│   │   ├── about/              # Culinary heritage page
│   │   ├── menu-preview/       # Public A La Carte menu preview
│   │   ├── menu/[slug]/        # Mobile Digital QR Menu for dining tables
│   │   ├── orders/[orderId]/   # Live customer order tracking view
│   │   ├── gallery/            # Food & ambience photo gallery
│   │   ├── location/           # Opening hours, address & map
│   │   ├── reviews/            # Verified guest reviews & submission form
│   │   ├── contact/            # Concierge & reservation contact
│   │   ├── privacy/            # Privacy policy
│   │   ├── terms/              # Terms and conditions
│   │   └── admin/              # Staff & Kitchen management dashboard
│   ├── components/             # Reusable UI components (Navbar, Footer, CartDrawer, Modals)
│   ├── features/               # Feature modules (cart, menu, auth, orders)
│   ├── repositories/           # Type-safe API client repositories
│   ├── types/                  # Shared TypeScript interfaces
│   ├── Dockerfile
│   └── package.json
│
├── docker-compose.yml          # Multi-container orchestration
├── .env.example
└── README.md
```

---

## 🚀 Quick Start Guide

### Prerequisites
- Node.js (v18+)
- Docker Desktop or local MySQL 8.0 instance

### 1. Database & Backend Setup
```bash
# In the backend directory:
cd backend

# Install dependencies
npm install

# Start MySQL via Docker if not already running
docker run -d --name restaurant-mysql -e MYSQL_ROOT_PASSWORD=restaurant_root_password -e MYSQL_DATABASE=restaurant_db -e MYSQL_USER=restaurant_user -e MYSQL_PASSWORD=restaurant_password -p 3306:3306 --restart unless-stopped mysql:8.0

# Sync schema and generate Prisma client
npx prisma db push

# Seed restaurant tables, categories, dishes, and staff accounts
npx tsx prisma/seed.ts

# Run the test suite
npm test

# Start the Backend Server (Port 5000)
npm run dev
```

### 2. Frontend Setup
```bash
# In a new terminal window:
cd portfolio-qrbase

# Install dependencies
npm install

# Start Next.js Development Server (Port 3000)
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) to view the restaurant portfolio!

---

## 👥 Default Demo Credentials

| Role | Email | Password |
|---|---|---|
| **Owner / Admin** | `admin@saffronember.com` | `Admin@123456` |
| **Manager** | `manager@saffronember.com` | `Admin@123456` |
| **Staff** | `staff@saffronember.com` | `Admin@123456` |

---

## 📱 Testing Table QR Digital Ordering

1. Navigate to:
   [http://localhost:3000/menu/saffron-ember?table=T-01](http://localhost:3000/menu/saffron-ember?table=T-01)
2. Notice the sticky header verifies **"Table T-01"**.
3. Select any dish (e.g. *Smoked Truffle Paneer Tikka*).
4. Customize portion, select optional truffle glaze add-on, enter cooking notes, and click **"Add to Cart"**.
5. Click **"View Cart"** and proceed to checkout.
6. Enter customer name, choose **"Online Payment"** or **"Pay at Counter"**, and confirm order.
7. You are redirected to `/orders/[orderId]` displaying the **live preparation timeline**.
8. In another tab, open [http://localhost:3000/admin](http://localhost:3000/admin) to view the incoming order, accept it, and advance the status from **Preparing** to **Served**! Notice the customer screen updates automatically via Socket.IO.

---

## 🔒 Security & Architecture Highlights

1. **Zero Client Price Trust**: The backend ignores prices sent by the client; unit prices, variant adjustments, add-ons, 5% GST, and 2.5% service charges are calculated strictly on the server.
2. **Decimal Precision**: Authoritative financial figures are computed in cents/paise integers to prevent IEEE 754 float drift.
3. **Idempotency Protection**: Prevents duplicate order submission if a customer taps submit multiple times.
4. **Database Snapshots**: Each `OrderItem` and `OrderItemAddon` stores an immutable snapshot of names and prices at the time of purchase.
5. **Role-Based Access Control**: Sensitive routes (`/api/admin/*`) require verified JWTs and restaurant membership.
6. **Rate Limiting**: Rate limits applied to authentication, orders, and public endpoints via `express-rate-limit`.

---

## 🐳 Docker Deployment

To launch the complete stack with persistent volumes using Docker Compose:

```bash
docker compose up -d --build
```
- Frontend: `http://localhost:3000`
- Backend API: `http://localhost:5000`
- MySQL: `localhost:3306`

#   r e s t a u r a n t  
 