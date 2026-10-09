import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Routes, Route } from 'react-router';
import './styles.css';
import { AuthProvider } from './auth.jsx';
import { BalloonProvider } from './balloon.jsx';
import Home from './pages/Home.jsx';
import Login from './pages/Login.jsx';
import Activity from './pages/Activity.jsx';
import Profile from './pages/Profile.jsx';
import Drop from './pages/Drop.jsx';
import Draw from './pages/Draw.jsx';
import AdminLayout from './pages/admin/AdminLayout.jsx';
import AdminEvents from './pages/admin/AdminEvents.jsx';
import AdminEvent from './pages/admin/AdminEvent.jsx';
import AdminMailTest from './pages/admin/AdminMailTest.jsx';

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <BalloonProvider>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/login" element={<Login />} />
          <Route path="/profile" element={<Profile />} />
          <Route path="/activity" element={<Activity />} />
          <Route path="/activity/drop" element={<Drop />} />
          <Route path="/activity/draw" element={<Draw />} />
          <Route path="/admin" element={<AdminLayout />}>
            <Route index element={<AdminEvents />} />
            <Route path="events/:id" element={<AdminEvent />} />
            <Route path="mail" element={<AdminMailTest />} />
          </Route>
        </Routes>
        </BalloonProvider>
      </AuthProvider>
    </BrowserRouter>
  </StrictMode>,
);
