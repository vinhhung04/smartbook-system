# SmartBook - Auth, Books API, Login Integration

Tai lieu nay mo ta cac thay doi da duoc them de hoan thanh 3 nhiem vu:
- Auth middleware bao ve API backend
- API lay danh sach sach
- Frontend dang nhap va tu dong dinh kem JWT

## 1) Backend da them

### Files da tao/sua
- inventory-service/src/middlewares/auth.middleware.js
- inventory-service/src/controllers/book.controller.js
- inventory-service/src/routes/book.routes.js
- inventory-service/src/index.js
- inventory-service/package.json

### Auth middleware
- Doc header Authorization theo dinh dang Bearer token
- Verify token bang process.env.JWT_SECRET
- Gan payload vao req.user
- Tra ve:
  - 401 neu thieu token/sai format
  - 403 neu token het han hoac khong hop le

### Books API
- Endpoint bao ve bang middleware auth:
  - GET /api/books
- Controller su dung Prisma:
  - prisma.book.findMany()

### Dang ky route trong server
Da duoc dang ky trong inventory-service/src/index.js:

app.use('/api/books', bookRoutes);

## 2) Frontend da them

### Files da tao/sua
- smartbook-ui/src/services/api.js
- smartbook-ui/src/pages/LoginPage.jsx
- smartbook-ui/src/App.jsx

### API service
Trong smartbook-ui/src/services/api.js:
- getToken, setToken, clearToken
- apiRequest tu dong gan header Authorization: Bearer <token>
- login goi POST /auth/login, nhan token va luu localStorage

### Login page
Trong smartbook-ui/src/pages/LoginPage.jsx:
- Form gom identifier + password
- Goi login() khi submit
- Luu token vao localStorage
- Hien thi loi dang nhap (inline + alert)

### Route guard
Trong smartbook-ui/src/App.jsx:
- Route /login la route public
- Cac route con lai duoc bao ve boi ProtectedLayout
- Neu chua co token se redirect ve /login

## 3) Bien moi truong goi y

Tao file smartbook-ui/.env (neu chua co):

VITE_API_BASE_URL=http://localhost:3001
VITE_AUTH_BASE_URL=http://localhost:3000

Luu y:
- Neu backend auth cua ban cung chay trong inventory-service thi co the dat VITE_AUTH_BASE_URL=http://localhost:3001

## 4) Cach chay nhanh

### Backend
1. Di chuyen vao thu muc inventory-service
2. Cai package:
   npm install
3. Dam bao .env co JWT_SECRET va DATABASE_URL
4. Chay server:
   npm run dev

### Frontend
1. Di chuyen vao thu muc smartbook-ui
2. Cai package:
   npm install
3. Chay:
   npm run dev

## 5) Kiem tra API books (co auth)

Sau khi dang nhap thanh cong, lay token va test:

curl -H "Authorization: Bearer YOUR_TOKEN" http://localhost:3001/api/books

Neu token hop le: tra ve danh sach sach
Neu thieu/sai token: 401/403

## 6) Ghi chu

- Model Prisma dang dung la Book, nen controller su dung prisma.book.findMany()
- jsonwebtoken da duoc them vao dependencies cua inventory-service