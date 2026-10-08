import { useEffect } from 'react';
import { Link, Outlet, useNavigate } from 'react-router';
import { useAuth } from '../../auth.jsx';

export default function AdminLayout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (user === null) navigate('/login?next=/admin', { replace: true });
  }, [user, navigate]);

  if (user === undefined) return <main className="page"><p className="muted">載入中…</p></main>;
  if (!user) return null;
  if (!user.isAdmin) {
    return (
      <main className="page">
        <p className="error">{user.email} 不是管理者帳號。</p>
        <button className="btn btn-ghost" onClick={logout}>登出</button>
      </main>
    );
  }

  return (
    <>
      <nav className="admin-nav">
        <Link to="/admin" className="brand">文化扭蛋機・後台</Link>
        <Link to="/admin">活動</Link>
        <Link to="/admin/mail">寄信測試</Link>
        <span className="spacer" />
        <span className="muted">{user.email}</span>
        <button className="btn btn-ghost btn-sm" onClick={async () => { await logout(); navigate('/login'); }}>登出</button>
      </nav>
      <main className="page page-wide">
        <Outlet />
      </main>
    </>
  );
}
