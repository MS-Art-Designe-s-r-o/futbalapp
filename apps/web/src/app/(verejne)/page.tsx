import type { Metadata } from 'next';
import Image from 'next/image';
import Link from 'next/link';
import { getArticles, getEvents } from '@/lib/verejne/public-api';
import { DEFAULT_TZ, dateKey, shiftDate } from '@/lib/verejne/format';
import MatchCard from '@/components/verejne/MatchCard';
import ArticleCard from '@/components/verejne/ArticleCard';
import { pageMeta } from '@/lib/verejne/seo';
import { SITE_URL } from '@/lib/verejne/site';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = {
  ...pageMeta({ title: 'FK Košická Nová Ves — Naša štvrť. Náš futbal.', description: 'FK Košická Nová Ves: mužstvá, zápasy, tréningy a novinky z klubu.', path: '/', hero: true }),
  title: { absolute: 'FK Košická Nová Ves — Naša štvrť. Náš futbal.' },
};

/** Statické štruktúrované dáta – len overené údaje (názov, URL, logo). */
const JSON_LD = JSON.stringify({
  '@context': 'https://schema.org',
  '@type': 'SportsOrganization',
  name: 'FK Košická Nová Ves',
  url: SITE_URL,
  logo: `${SITE_URL}/logo.png`,
  sport: 'Soccer',
}).replace(/</g, '\\u003c');

export default async function Home() {
  const today = dateKey(new Date(), DEFAULT_TZ);
  const [upcoming, recent, articles] = await Promise.all([
    getEvents({ type: 'match', from: today, limit: 6 }),
    getEvents({ type: 'match', from: shiftDate(today, -120), to: today, limit: 100 }),
    getArticles(),
  ]);
  const tz = upcoming.club.timezone || DEFAULT_TZ;
  const nextMatches = upcoming.events.filter((e) => e.state !== 'FINISHED').slice(0, 3);
  const results = recent.events
    .filter((e) => e.state === 'FINISHED')
    .sort((a, b) => b.startAt.localeCompare(a.startAt))
    .slice(0, 3);
  const news = [...articles]
    .sort((a, b) => Number(a.isArchive) - Number(b.isArchive) || b.publishedAt.localeCompare(a.publishedAt))
    .slice(0, 3);

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON_LD }} />
      <section className="hero">
        <Image className="hero-bg" src="/verejne/hero-bg.jpg" alt="" fill priority sizes="100vw" quality={75} />
        <div className="hero-grid" />
        <div>
          <div className="eyebrow">KOŠICKÁ NOVÁ VES · OD ROKU 1935</div>
          <h1>NÁŠ OKRES,<br />NÁŠ KLUB,<br />NÁŠ <em>FUTBAL.</em></h1>
          <p>Veľké sny sa začínajú na našom ihrisku.<br />Zaži futbal, ktorý nás spája.</p>
          <div className="hero-actions">
            <Link className="btn" href="/muzstva">Spoznaj naše tímy <span>↗</span></Link>
            <Link className="btn outline" href="/kalendar">Program zápasov <span>→</span></Link>
          </div>
        </div>
        <div className="hero-number"><strong>1935</strong><small>TRADÍCIA, KTORÁ ŽIJE.</small></div>
        <span className="hero-caption">Ilustračná fotografia · AI vizualizácia, nejde o členov klubu</span>
      </section>

      <div className="strip">
        <span>JEDEN KLUB. SPOLOČNÁ VÁŠEŇ.</span>
        <strong>Od prvého kopu až po A-tím.</strong>
        <Link href="/klub">Spoznaj FK KNV ↗</Link>
      </div>

      <section className="section">
        <div className="section-head">
          <div><h2>NA RADE JE FUTBAL.</h2><p>Najbližšie zápasy našich mužstiev</p></div>
          <Link href="/kalendar" className="text-link">Celý kalendár <span>↗</span></Link>
        </div>
        {nextMatches.length ? (
          <div className="match-grid">
            {nextMatches.map((e, i) => <MatchCard key={e.id} event={e} tz={tz} featured={i === 0} />)}
          </div>
        ) : (
          <div className="empty">Zatiaľ nie sú naplánované žiadne zápasy.</div>
        )}
      </section>

      <section className="section compact">
        <div className="section-head">
          <div><h2>POSLEDNÉ VÝSLEDKY.</h2><p>Naposledy odohrané zápasy</p></div>
        </div>
        {results.length ? (
          <div className="match-grid">
            {results.map((e) => <MatchCard key={e.id} event={e} tz={tz} label="VÝSLEDOK" />)}
          </div>
        ) : (
          <div className="empty">Zatiaľ nie sú k dispozícii žiadne výsledky.</div>
        )}
      </section>

      <section className="section alt">
        <div className="team-intro">
          <div>
            <div className="eyebrow">BUDÚCNOSŤ MÁ NAŠE FARBY</div>
            <h2>MALÝ KLUB.<br /><span>VEĽKÉ SNY.</span></h2>
            <p>Spoznaj novú generáciu FK KNV. Tímová hra, priateľstvá a chuť posúvať sa ďalej.</p>
            <Link href="/muzstva" className="text-link">Preskúmaj mužstvá <span>↗</span></Link>
          </div>
          <figure className="team-art">
            <Image src="/verejne/team-photo.jpg" alt="Skupina siedmich chlapcov v klubových dresoch pózuje na štadióne" fill sizes="(max-width: 800px) 100vw, 60vw" quality={75} />
            <figcaption>Ilustračná grafika – AI vizualizácia, nejde o členov klubu</figcaption>
          </figure>
        </div>
      </section>

      <section className="section">
        <div className="section-head">
          <div><h2>ŽIVOT NÁŠHO KLUBU.</h2><p>Príbehy, tradícia a ľudia, ktorí nás spájajú</p></div>
          <Link href="/novinky" className="text-link">Všetky novinky <span>↗</span></Link>
        </div>
        {news.length ? (
          <div className="news-grid">{news.map((a) => <ArticleCard key={a.id} article={a} tz={tz} />)}</div>
        ) : (
          <div className="empty">Zatiaľ tu nie sú žiadne články.</div>
        )}
      </section>

      <section className="join-banner">
        <div>
          <h2>TVOJE MIESTO JE NA IHRISKU.</h2>
          <p>Pridaj sa k FK Košická Nová Ves. Ďalšia kapitola môže byť aj tvoja.</p>
        </div>
        <Link className="btn" href="/registracia">Chcem hrať za KNV <span>↗</span></Link>
      </section>
    </>
  );
}
