import { Link } from 'react-router';
import { categoryLabel, durationLabel, fmtTime, CAPSULE_STATUS } from './api.js';
import { CategoryIcon, HalfCapsule } from './icons.jsx';

export function Brand({ subtitle }) {
  return (
    <header className="brand-header">
      <Link to="/" className="brand-link">
        <h1 className="brand">文化扭蛋機</h1>
      </Link>
      <p className="tagline">{subtitle || 'Give! Exchange! Connect! Taitung Culture!'}</p>
    </header>
  );
}

export function Footer() {
  return <footer className="footer-band">台東文化願景論壇・Gently Radical, Wildly Local</footer>;
}

// The four steps from the poster (decision 26).
export function HowItWorks() {
  const steps = [
    ['投入資源', '準備一份「可控、可完成、可收穫」的輕量資源，5 小時內可以完成的小小分享。'],
    ['抽出扭蛋', '投入一顆，就能轉一次扭蛋機，隨機抽到另一位參與者的扭蛋。'],
    ['交換合作', '抽到後聯絡蛋友，一起討論怎麼交換。前提只有：自主、知情、雙方同意。'],
    ['每季派對', '每場活動有開始和結束的時間，結束後，下一場活動再見。'],
  ];
  return (
    <ol className="steps">
      {steps.map(([title, text], i) => (
        <li key={title}>
          <span className="step-num"><HalfCapsule size={30} /><b>{i + 1}</b></span>
          <div><h3>{title}</h3><p>{text}</p></div>
        </li>
      ))}
    </ol>
  );
}

// How a capsule looks to whoever draws it. Used in the drop preview and after a draw.
export function CapsuleCard({ capsule, provider, children }) {
  return (
    <article className="capsule-card">
      <div className="capsule-card-head">
        <span className="capsule-cat"><CategoryIcon category={capsule.category} size={20} /> {categoryLabel(capsule.category)}</span>
        <span className="capsule-dur">{durationLabel(capsule.duration)}</span>
      </div>
      <h3 className="capsule-title">{capsule.title}</h3>
      <p className="capsule-desc">{capsule.description}</p>
      {capsule.conditions && <p className="capsule-cond"><b>使用條件</b>　{capsule.conditions}</p>}
      {provider && <ContactBlock person={provider} label="提供者" />}
      {children}
    </article>
  );
}

const lineUrl = (id) => `https://line.me/ti/p/~${encodeURIComponent(id.replace(/^@/, ''))}`;
const igUrl = (h) => `https://instagram.com/${encodeURIComponent(h.replace(/^@/, ''))}`;

export function ContactBlock({ person, label }) {
  return (
    <div className="contact">
      <p className="contact-who">
        <span className="muted">{label}</span> <b>{person.nickname}</b>
        {person.region && <span className="muted">・{person.region}</span>}
      </p>
      {person.bio && <p className="contact-bio">{person.bio}</p>}
      <ul className="contact-list">
        {person.organizer && <li><span>聯絡</span>{person.contact}</li>}
        {person.line_id && <li><span>LINE</span><a href={lineUrl(person.line_id)} target="_blank" rel="noreferrer">{person.line_id}</a></li>}
        {person.instagram && <li><span>IG</span><a href={igUrl(person.instagram)} target="_blank" rel="noreferrer">{person.instagram}</a></li>}
        {person.phone && <li><span>電話</span><a href={`tel:${person.phone}`}>{person.phone}</a></li>}
        {person.email && <li><span>Email</span><a href={`mailto:${person.email}`}>{person.email}</a></li>}
      </ul>
    </div>
  );
}

export function Loading() {
  return <main className="page"><p className="muted">載入中…</p></main>;
}

// "我抽到的 / 我投入的" lists, shared by an activity page and the home page.
export function MyRecords({ draws, capsules, headingLevel: H = 'h2', showRound = true }) {
  return (
    <>
      {draws.length > 0 && (
        <section>
          <H className="records-title">我抽到的扭蛋</H>
          <p className="muted small">聯絡蛋友，一起討論怎麼交換。前提只有：自主、知情、雙方同意。</p>
          {draws.map((d) => (
            <CapsuleCard key={d.draw_id} capsule={d.capsule} provider={d.provider}>
              <p className="muted small">{showRound && `${d.round_name}・`}{fmtTime(d.drawn_at)} 抽到</p>
            </CapsuleCard>
          ))}
        </section>
      )}
      {capsules.length > 0 && (
        <section>
          <H className="records-title">我投入的扭蛋</H>
          {capsules.map((c) => (
            <CapsuleCard key={c.id} capsule={c}>
              <p className="small">
                <span className={`tag ${c.status === 'drawn' ? 'tag-solid' : c.status === 'removed' ? 'tag-muted' : ''}`}>{CAPSULE_STATUS[c.status]}</span>
                {showRound && <span className="muted">　{c.round_name}</span>}
              </p>
              {c.drawnBy.map((p, i) => <ContactBlock key={i} person={p} label="抽到的蛋友" />)}
              {c.status === 'removed' && <p className="muted small">這顆扭蛋已被主辦方下架，有疑問請聯絡主辦方。</p>}
            </CapsuleCard>
          ))}
        </section>
      )}
    </>
  );
}
