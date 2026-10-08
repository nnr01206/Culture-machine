import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Routes, Route } from 'react-router';
import './styles.css';
import { AuthProvider } from './auth.jsx';
import Home from './pages/Home.jsx';
import Login from './pages/Login.jsx';
import Activity from './pages/Activity.jsx';
import Profile from './pages/Profile.jsx';
import Drop from './pages/Drop.jsx';
import Draw from './pages/Draw.jsx';
import AdminLayout from './pages/admin/AdminLayout.jsx';
import AdminActivities from './pages/admin/AdminActivities.jsx';
import AdminActivity from './pages/admin/AdminActivity.jsx';
import AdminMailTest from './pages/admin/AdminMailTest.jsx';

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/login" element={<Login />} />
          <Route path="/profile" element={<Profile />} />
          <Route path="/activity" element={<Activity />} />
          <Route path="/activity/drop" element={<Drop />} />
          <Route path="/activity/draw" element={<Draw />} />
          <Route path="/admin" element={<AdminLayout />}>
            <Route index element={<AdminActivities />} />
            <Route path="activities/:id" element={<AdminActivity />} />
            <Route path="mail" element={<AdminMailTest />} />
          </Route>
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  </StrictMode>,
);
