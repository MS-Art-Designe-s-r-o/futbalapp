import Link from 'next/link';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Ochrana osobných údajov — FK Košická Nová Ves',
  description:
    'Zásady ochrany osobných údajov a informácie o spracúvaní (GDPR) pre hráčov, rodičov a členov FK Košická Nová Ves.',
};

/**
 * Zásady ochrany osobných údajov FK Košická Nová Ves (informačná povinnosť podľa čl. 13 GDPR).
 *
 * Text popisuje reálne spracúvanie v portáli (registrácia, ISSF, platby, komunikácia, fotografie,
 * mobilná aplikácia). Uvedený je ako Privacy policy URL v App Store aj Google Play. Pri zmene
 * sprostredkovateľov alebo rozsahu údajov treba zosúladiť aj Google Data safety. Právnu kontrolu
 * textu (najmä lehoty uchovávania a prenosy do tretích krajín) odporúčame ponechať na advokáta klubu.
 */

const TOC: Array<[string, string]> = [
  ['kratko', 'Stručne'],
  ['prevadzkovatel', 'Kto sme'],
  ['udaje', 'Aké údaje a prečo'],
  ['zdroje', 'Odkiaľ údaje máme'],
  ['kto-vidi', 'Kto údaje vidí'],
  ['prijemcovia', 'Komu ich sprístupňujeme'],
  ['deti', 'Údaje detí'],
  ['doba', 'Ako dlho ich uchovávame'],
  ['prava', 'Vaše práva'],
  ['bezpecnost', 'Zabezpečenie'],
  ['cookies', 'Cookies'],
  ['zmeny', 'Zmeny textu'],
];

interface Row {
  what: string;
  data: string;
  why: string;
  basis: string;
  keep: string;
}

const ROWS: Row[] = [
  {
    what: 'Registrácia hráča',
    data: 'meno, priezvisko, rodné číslo, dátum narodenia, pohlavie, krajina pôvodu, adresa, registračné číslo, materský a hosťujúci klub, klubová príslušnosť',
    why: 'členstvo v klube, registrácia hráča v systéme ISSF zväzu, zaradenie do správnej vekovej kategórie a družstva',
    basis: 'plnenie zmluvy (členstvo), zákonná povinnosť a pravidlá zväzu',
    keep: 'počas členstva a 2 roky po jeho skončení',
  },
  {
    what: 'Zákonný zástupca / rodič',
    data: 'meno, priezvisko, e-mail, telefón, vzťah k hráčovi',
    why: 'zastupovanie dieťaťa, prihlásenie do portálu, komunikácia, platby',
    basis: 'plnenie zmluvy',
    keep: 'počas členstva dieťaťa a 2 roky po jeho skončení',
  },
  {
    what: 'Fotografia hráča na registráciu',
    data: 'portrétna fotografia',
    why: 'registrácia hráča v ISSF a jeho identifikácia',
    basis: 'plnenie zmluvy a pravidlá zväzu',
    keep: 'počas členstva',
  },
  {
    what: 'Zverejnenie mena a fotografie (web, galéria, sociálne siete)',
    data: 'meno, fotografie a videá z tréningov a zápasov',
    why: 'propagácia klubu a športových výsledkov',
    basis: 'súhlas (nepovinný, kedykoľvek odvolateľný)',
    keep: 'do odvolania súhlasu',
  },
  {
    what: 'Zdravotné poznámky',
    data: 'informácie, ktoré dobrovoľne uvediete (napr. alergie, obmedzenia)',
    why: 'bezpečnosť dieťaťa na tréningoch a zápasoch',
    basis: 'výslovný súhlas (osobitná kategória údajov), ktorý môžete kedykoľvek odvolať',
    keep: 'počas členstva, najdlhšie do odvolania súhlasu',
  },
  {
    what: 'Športová činnosť',
    data: 'dochádzka, nominácie, zápasy, góly a štatistiky, previerky výkonnosti, družstvo',
    why: 'organizácia tréningového procesu a zápasov',
    basis: 'plnenie zmluvy a oprávnený záujem klubu',
    keep: 'počas členstva a 2 roky po jeho skončení',
  },
  {
    what: 'Členské a platby',
    data: 'predpis, variabilný symbol, stav úhrady; z bankového výpisu meno platiteľa, číslo účtu a správa pre prijímateľa; upomienky',
    why: 'evidencia a párovanie členských poplatkov, upomienky, účtovníctvo',
    basis: 'plnenie zmluvy a zákonná povinnosť (účtovníctvo)',
    keep: 'účtovné doklady 10 rokov',
  },
  {
    what: 'Komunikácia',
    data: 'správy v chate družstva, oznamy, e-maily, push upozornenia, zariadenie pre notifikácie',
    why: 'oznamy, zmeny termínov, nominácie, pripomienky platieb',
    basis: 'plnenie zmluvy a oprávnený záujem klubu',
    keep: 'počas členstva',
  },
  {
    what: 'Prihlásenie a bezpečnosť',
    data: 'e-mail, heslo (ukladáme len v zašifrovanej podobe), technické záznamy o prihlásení',
    why: 'prístup do portálu a ochrana pred zneužitím',
    basis: 'plnenie zmluvy a oprávnený záujem klubu (bezpečnosť)',
    keep: 'počas existencie konta',
  },
];

function H({ id, children }: { id: string; children: React.ReactNode }) {
  return (
    <h2 id={id} className="scroll-mt-6 text-lg font-bold text-club-900">
      {children}
    </h2>
  );
}

export default function PrivacyPage() {
  return (
    <main className="min-h-screen bg-club-50 px-4 py-10 sm:px-6">
      <div className="mx-auto grid max-w-5xl items-start gap-6 lg:grid-cols-[13rem_minmax(0,1fr)]">
        <nav aria-label="Obsah" className="rounded-lg border border-club-100 bg-white p-4 text-sm shadow-sm lg:sticky lg:top-6">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-club-600">Obsah</p>
          <ol className="space-y-1.5">
            {TOC.map(([id, label]) => (
              <li key={id}>
                <a href={`#${id}`} className="text-gray-600 hover:text-club-700 hover:underline">
                  {label}
                </a>
              </li>
            ))}
          </ol>
        </nav>

        <article className="min-w-0 space-y-8 rounded-lg border border-club-100 bg-white p-6 text-sm leading-relaxed text-gray-700 shadow-sm sm:p-8">
          <header className="space-y-2">
            <Link href="/prihlasenie" className="text-sm text-club-600 hover:underline">
              ← Späť na prihlásenie
            </Link>
            <h1 className="text-2xl font-bold text-club-900">Ochrana osobných údajov (GDPR)</h1>
            <p className="text-gray-500">
              Informácie o spracúvaní osobných údajov podľa čl. 13 Nariadenia (EÚ) 2016/679 (GDPR) a zákona č. 18/2018 Z. z.
              · Účinné od 18. 11. 2026
            </p>
          </header>

          <section className="space-y-3">
            <H id="kratko">Stručne</H>
            <ul className="list-disc space-y-1 pl-5">
              <li>Údaje zbierame len na to, aby mohol hráč hrať: členstvo, registrácia v ISSF, tréningy, zápasy, platby a komunikácia.</li>
              <li>Údaje <strong>nepredávame</strong> a nepoužívame ich na reklamu.</li>
              <li>Fotografie a mená zverejňujeme len s vaším súhlasom, ktorý môžete kedykoľvek odvolať.</li>
              <li>Každý v klube vidí len to, čo potrebuje: rodič svoje deti, tréner svoje družstvá, platby len vedenie.</li>
              <li>Máte právo na prístup, opravu aj vymazanie údajov. Stačí napísať na kontakt nižšie.</li>
            </ul>
          </section>

          <section className="space-y-2">
            <H id="prevadzkovatel">1. Kto sme (prevádzkovateľ)</H>
            <p>
              Prevádzkovateľom je <strong>FK Košická Nová Ves</strong>, Agátová 1, 040 14 Košice, IČO 31 942 059 (ďalej
              „klub“). Klub určuje, aké údaje spracúva a na aký účel.
            </p>
            <p>
              Kontakt vo veciach ochrany osobných údajov (manažér klubu):{' '}
              <a href="mailto:fkknv1935@gmail.com" className="text-club-700 hover:underline">
                fkknv1935@gmail.com
              </a>
              , +421 903 903 936. Technické otázky k portálu:{' '}
              <a href="mailto:info@fkknv.sk" className="text-club-700 hover:underline">
                info@fkknv.sk
              </a>
              . Zodpovednú osobu (DPO) klub nemá ustanovenú, lebo mu to zákon nenariaďuje.
            </p>
          </section>

          <section className="space-y-3">
            <H id="udaje">2. Aké údaje spracúvame a prečo</H>
            <p>Pre každú oblasť uvádzame údaje, účel, právny základ a dobu uchovávania.</p>
            <div className="space-y-3 md:hidden">
              {ROWS.map((r) => (
                <div key={r.what} className="rounded-md border border-club-100 p-3">
                  <h3 className="font-semibold text-club-800">{r.what}</h3>
                  <dl className="mt-1 space-y-1">
                    <div><dt className="inline font-medium">Údaje: </dt><dd className="inline">{r.data}</dd></div>
                    <div><dt className="inline font-medium">Účel: </dt><dd className="inline">{r.why}</dd></div>
                    <div><dt className="inline font-medium">Právny základ: </dt><dd className="inline">{r.basis}</dd></div>
                    <div><dt className="inline font-medium">Uchovávanie: </dt><dd className="inline">{r.keep}</dd></div>
                  </dl>
                </div>
              ))}
            </div>
            <div className="hidden overflow-x-auto md:block">
              <table className="w-full min-w-[44rem] border-collapse text-left text-xs">
                <thead>
                  <tr className="bg-club-50 text-club-800">
                    <th className="border border-club-100 p-2">Oblasť</th>
                    <th className="border border-club-100 p-2">Údaje</th>
                    <th className="border border-club-100 p-2">Účel</th>
                    <th className="border border-club-100 p-2">Právny základ</th>
                    <th className="border border-club-100 p-2">Uchovávanie</th>
                  </tr>
                </thead>
                <tbody>
                  {ROWS.map((r) => (
                    <tr key={r.what} className="align-top">
                      <th className="border border-club-100 p-2 font-semibold text-club-900">{r.what}</th>
                      <td className="border border-club-100 p-2">{r.data}</td>
                      <td className="border border-club-100 p-2">{r.why}</td>
                      <td className="border border-club-100 p-2">{r.basis}</td>
                      <td className="border border-club-100 p-2">{r.keep}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p>
              <strong>Prečo potrebujeme údaje pri registrácii:</strong> bez mena, dátumu narodenia, registračných údajov a
              fotografie nevieme hráča zaregistrovať v ISSF, a teda ho nemôžeme prihlásiť do súťažných zápasov. Poskytnutie
              týchto údajov je preto podmienkou členstva. Údaje označené ako nepovinné (súhlas s fotografiami, zdravotné
              poznámky) môžete odmietnuť bez dôsledkov pre členstvo.
            </p>
            <p>
              Rozhodovanie výlučne automatizovanými prostriedkami ani profilovanie klub nevykonáva. Zaradenie do
              kategórie podľa ročníka navrhuje systém, vždy ho však potvrdí človek z vedenia.
            </p>
          </section>

          <section className="space-y-2">
            <H id="zdroje">3. Odkiaľ údaje máme</H>
            <ul className="list-disc space-y-1 pl-5">
              <li>priamo od vás (registrácia, formulár na doplnenie údajov, profil v portáli),</li>
              <li>od zväzu: údaje o hráčovi v ISSF a verejne dostupné rozpisy a výsledky súťaží (futbalnet / sportnet),</li>
              <li>od banky klubu: pohyby na účte (meno platiteľa, číslo účtu, správa) na párovanie členských platieb.</li>
            </ul>
          </section>

          <section className="space-y-2">
            <H id="kto-vidi">4. Kto v klube údaje vidí</H>
            <ul className="list-disc space-y-1 pl-5">
              <li><strong>Rodič / zákonný zástupca:</strong> údaje a platby svojich detí.</li>
              <li><strong>Hráč:</strong> svoje údaje a platby.</li>
              <li><strong>Tréner:</strong> údaje hráčov svojho družstva vrátane zdravotných poznámok, bez bankových a platobných údajov.</li>
              <li><strong>Vedenie klubu a administrátor:</strong> údaje potrebné na správu klubu vrátane platieb a registrácií.</li>
              <li><strong>Verejnosť (web):</strong> len meno a fotografia hráčov, ktorí s tým udelili súhlas.</li>
            </ul>
            <p>Oprávnenia kontroluje priamo server, nielen vzhľad aplikácie.</p>
          </section>

          <section className="space-y-2">
            <H id="prijemcovia">5. Komu údaje sprístupňujeme</H>
            <ul className="list-disc space-y-1 pl-5">
              <li>príslušnému futbalovému zväzu (SFZ a regionálny zväz) — registrácia hráča v ISSF a súťaže,</li>
              <li>
                <strong>MS Art Designe s. r. o.</strong> — vývoj, prevádzka a technická správa portálu a mobilnej aplikácie
                (sprostredkovateľ),
              </li>
              <li>poskytovateľ serverového hostingu, na ktorom portál beží (sprostredkovateľ),</li>
              <li>Resend — doručovanie e-mailov z portálu (sprostredkovateľ),</li>
              <li>Expo — doručovanie push upozornení do mobilnej aplikácie (sprostredkovateľ),</li>
              <li>banka klubu, účtovník klubu a orgány verejnej moci, ak to vyžaduje zákon.</li>
            </ul>
            <p>
              Sprostredkovatelia spracúvajú údaje len na pokyn klubu a na uvedený účel. Niektorí z nich (Resend, Expo)
              môžu údaje spracúvať aj mimo EÚ, najmä v USA. Prenos sa deje len na základe záruk podľa GDPR, napríklad
              štandardných zmluvných doložiek EÚ. <strong>Údaje nepredávame a neposkytujeme ich na reklamné účely.</strong>
            </p>
          </section>

          <section className="space-y-2">
            <H id="deti">6. Údaje detí</H>
            <p>
              Za dieťa konajú jeho rodičia alebo zákonní zástupcovia: podávajú registráciu, udeľujú alebo odvolávajú
              súhlasy a uplatňujú práva dieťaťa. Fotografie dieťaťa zverejňujeme len na základe súhlasu zákonného
              zástupcu. Ak ste súhlas udelili, môžete ho kedykoľvek odvolať a fotografie z webu odstránime.
            </p>
          </section>

          <section className="space-y-2">
            <H id="doba">7. Ako dlho údaje uchovávame</H>
            <p>
              Údaje uchovávame po dobu členstva a následne 2 roky po jeho skončení, potom ich vymažeme alebo
              anonymizujeme. Účtovné doklady a údaje o platbách uchovávame 10 rokov, ako ukladá zákon. Súhlasy
              (fotografie, zdravotné poznámky) platia do ich odvolania. Po vymazaní konta môžeme uchovať len údaje, ktoré
              musíme podľa zákona; o ich rozsahu vás informujeme.
            </p>
          </section>

          <section className="space-y-2">
            <H id="prava">8. Vaše práva a ako ich uplatniť</H>
            <ul className="list-disc space-y-1 pl-5">
              <li>právo na prístup k údajom a na ich kópiu,</li>
              <li>právo na opravu nesprávnych údajov,</li>
              <li>právo na vymazanie („byť zabudnutý“), ak neexistuje zákonný dôvod na ich uchovanie,</li>
              <li>právo na obmedzenie spracúvania a na prenosnosť údajov,</li>
              <li>právo namietať proti spracúvaniu založenému na oprávnenom záujme,</li>
              <li>právo kedykoľvek odvolať súhlas, bez vplyvu na zákonnosť spracúvania pred odvolaním.</li>
            </ul>
            <p>
              Žiadosť pošlite na{' '}
              <a href="mailto:fkknv1935@gmail.com" className="text-club-700 hover:underline">
                fkknv1935@gmail.com
              </a>{' '}
              alebo cez{' '}
              <Link href="/podpora#vymazanie-udajov" className="text-club-700 hover:underline">
                stránku podpory
              </Link>
              . Odpovieme najneskôr do 30 dní. Máte tiež právo podať sťažnosť Úradu na ochranu osobných údajov SR,
              Hraničná 12, 820 07 Bratislava 27,{' '}
              <a href="https://dataprotection.gov.sk" target="_blank" rel="noopener noreferrer" className="text-club-700 hover:underline">
                dataprotection.gov.sk
              </a>
              .
            </p>
          </section>

          <section className="space-y-2">
            <H id="bezpecnost">9. Ako údaje chránime</H>
            <ul className="list-disc space-y-1 pl-5">
              <li>komunikácia s portálom aj aplikáciou je šifrovaná (HTTPS),</li>
              <li>heslá sa neukladajú v čitateľnej podobe,</li>
              <li>prístup k údajom je obmedzený podľa roly a družstva a overuje sa na serveri,</li>
              <li>verejný registračný formulár je chránený proti automatizovanému zneužitiu (CAPTCHA),</li>
              <li>databázu pravidelne zálohujeme a prístup na server majú len poverené osoby.</li>
            </ul>
            <p>Ak by došlo k porušeniu ochrany údajov s rizikom pre vás, oznámime to úradu aj dotknutým osobám v zákonných lehotách.</p>
          </section>

          <section className="space-y-2">
            <H id="cookies">10. Cookies a lokálne úložisko</H>
            <p>
              Portál používa len technicky nevyhnutné lokálne úložisko potrebné na prihlásenie a fungovanie. Nepoužívame
              sledovacie ani reklamné cookies.
            </p>
          </section>

          <section className="space-y-2">
            <H id="zmeny">11. Zmeny tohto textu</H>
            <p>
              Text aktualizujeme pri zmene rozsahu údajov alebo poskytovateľov. Platné znenie je vždy na tejto stránke,
              s uvedeným dátumom účinnosti. O dôležitých zmenách vás informujeme v portáli alebo e-mailom.
            </p>
          </section>

          <p className="border-t border-club-100 pt-4 text-xs text-gray-400">
            Posledná aktualizácia: 18. 11. 2026 · FK Košická Nová Ves, Agátová 1, 040 14 Košice, IČO 31 942 059
          </p>
        </article>
      </div>
    </main>
  );
}
