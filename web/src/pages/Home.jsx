import { Link } from 'react-router';
import { useAuth } from '../auth.jsx';

export default function Home() {
  const { user } = useAuth();
  return (
    <main className="page">
      <h1 className="brand">文化扭蛋機</h1>
      <p className="tagline">Give! Exchange! Connect! Taitung Culture!</p>
      <div className="card">
        <p>每個人帶一點自己有的東西來，也帶走另一個人願意分享的東西。</p>
        <p className="muted">請掃描活動現場的 QR Code 進入扭蛋機。</p>
      </div>
      {user?.isAdmin && <Link className="btn" to="/admin">進入後台</Link>}
      {user === null && <Link className="btn btn-ghost" to="/login">登入</Link>}
      <footer className="footer-band">台東文化願景論壇・Gently Radical, Wildly Local</footer>
    </main>
  );
}
