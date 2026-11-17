'use client';

import Link from 'next/link';
import { useState } from 'react';

type Who = 'parent' | 'adult' | 'staff';

const WHO: Array<{ key: Who; label: string; hint: string }> = [
  { key: 'parent', label: 'Rodič / zákonný zástupca', hint: 'registrujem dieťa alebo si vytváram konto' },
  { key: 'adult', label: 'Hráč nad 18 rokov', hint: 'registrujem sa sám za seba' },
  { key: 'staff', label: 'Tréner, vedúci, ostatní', hint: 'konto zakladá vedenie klubu' },
];

interface Step {
  title: string;
  text: string;
}

const STEPS: Record<Who, Step[]> = {
  parent: [
    { title: 'Vyplníte registráciu', text: 'Na stránke Registrácia zadáte údaje o sebe a o dieťati (alebo detí, ak už v klube hrajú) a odsúhlasíte súhlasy.' },
    { title: 'Klub údaje skontroluje', text: 'Overíme hráča v systéme ISSF. Ak ho tam nenájdeme, pošleme vám e-mail s odkazom, cez ktorý údaje a fotku jednoducho doplníte.' },
    { title: 'Schválenie a zaradenie', text: 'Vedenie klubu prihlášku schváli, dieťa zaradí do správneho družstva a priradí ho k vášmu kontu.' },
    { title: 'Prihlásenie do portálu', text: 'Vedenie vám odovzdá prihlasovacie údaje. Po prvom prihlásení si zmeníte heslo a vidíte všetko o svojom dieťati.' },
  ],
  adult: [
    { title: 'Vyplníte registráciu', text: 'Na stránke Registrácia vyberiete „Som hráč nad 18 rokov“ a zadáte svoje údaje a súhlasy.' },
    { title: 'Klub údaje skontroluje', text: 'Overíme vás v systéme ISSF. Ak chýbajú údaje alebo fotka, pošleme vám e-mail s odkazom na ich doplnenie.' },
    { title: 'Schválenie a zaradenie', text: 'Vedenie klubu prihlášku schváli a zaradí vás do družstva.' },
    { title: 'Prihlásenie do portálu', text: 'Dostanete prihlasovacie údaje, po prvom prihlásení si zmeníte heslo.' },
  ],
  staff: [
    { title: 'Konto zakladá vedenie', text: 'Tréneri, vedúci a ďalší členovia tímu sa sami neregistrujú. Konto im vytvorí vedenie klubu.' },
    { title: 'Pridelenie funkcie a družstva', text: 'Tréner dostane prístup len k svojim družstvám, vedúci k celému klubu.' },
    { title: 'Prihlásenie do portálu', text: 'Prihlasovacie údaje dostanete od vedenia. Ak ste zároveň rodič, stačí jedno konto s viacerými rolami.' },
  ],
};

const WHY: Array<{ title: string; text: string }> = [
  { title: 'Registrácia v ISSF', text: 'Každý hráč musí mať platnú registráciu v systéme ISSF, inak nemôže nastúpiť na súťažné zápasy. Meno, dátum narodenia, registračné číslo, kluby a fotka sú údaje, ktoré k tomu potrebujeme.' },
  { title: 'Správna veková kategória', text: 'Z dátumu narodenia zaradíme hráča do správnej kategórie a družstva (U8 až Muži).' },
  { title: 'Fotografia', text: 'Slúži na registráciu hráča a na jeho identifikáciu. Verejne ju zverejňujeme len so súhlasom.' },
  { title: 'Kontakt na rodiča', text: 'Potrebujeme vás vedieť zastihnúť: oznamy, zmeny termínov, nominácie a platby.' },
];

const FEATURES: Array<{ title: string; text: string }> = [
  { title: 'Kalendár', text: 'Tréningy, zápasy, turnaje a zmeny termínov na jednom mieste.' },
  { title: 'Dochádzka a nominácie', text: 'Potvrdenie účasti a nominácia na zápasy.' },
  { title: 'Komunikácia', text: 'Oznamy a chat družstva, upozornenia v aplikácii aj e-mailom.' },
  { title: 'Platby', text: 'Prehľad predpisu, variabilný symbol a stav úhrady. Rodič vidí platby svojich detí.' },
  { title: 'Podklad pre príspevok', text: 'Potvrdenie pre športový príspevok na stiahnutie.' },
  { title: 'Mobilná aplikácia', text: 'Rovnaký prístup aj v telefóne, s upozorneniami.' },
];

export default function PortalGuide() {
  const [who, setWho] = useState<Who>('parent');
  return (
    <div className="space-y-8 text-gray-700">
      <section>
        <p className="text-xs font-semibold uppercase tracking-widest text-club-600">Klubový portál FK Košická Nová Ves</p>
        <h2 className="mt-1 text-2xl font-bold text-club-900">Ako sa dostať do portálu</h2>
        <p className="mt-2 text-sm">
          Portál slúži hráčom, rodičom a trénerom klubu. Vyberte, kto ste, a uvidíte presný postup.
        </p>
        <div className="mt-4 grid gap-2 sm:grid-cols-3" role="tablist" aria-label="Kto sa registruje">
          {WHO.map((w) => (
            <button
              key={w.key}
              type="button"
              role="tab"
              aria-selected={who === w.key}
              onClick={() => setWho(w.key)}
              className={`rounded-md border px-3 py-2 text-left text-sm ${
                who === w.key ? 'border-club-600 bg-club-50 font-semibold text-club-800' : 'border-gray-300 bg-white text-gray-600 hover:border-club-300'
              }`}
            >
              {w.label}
              <span className="block text-xs font-normal text-gray-500">{w.hint}</span>
            </button>
          ))}
        </div>
        <ol className="mt-5 space-y-3">
          {STEPS[who].map((s, i) => (
            <li key={s.title} className="flex gap-3">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-club-600 text-sm font-bold text-white">{i + 1}</span>
              <span className="min-w-0">
                <span className="block font-semibold text-club-900">{s.title}</span>
                <span className="block text-sm">{s.text}</span>
              </span>
            </li>
          ))}
        </ol>
        {who !== 'staff' && (
          <Link href="/registracia" className="mt-5 inline-block rounded-md bg-club-600 px-4 py-2 text-sm font-semibold text-white hover:bg-club-700">
            Prejsť na registráciu
          </Link>
        )}
      </section>

      <section>
        <h2 className="text-xl font-bold text-club-900">Prečo potrebujeme vaše údaje</h2>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          {WHY.map((w) => (
            <div key={w.title} className="rounded-md border border-club-100 bg-white p-3">
              <h3 className="text-sm font-semibold text-club-800">{w.title}</h3>
              <p className="mt-1 text-sm">{w.text}</p>
            </div>
          ))}
        </div>
        <p className="mt-3 text-xs text-gray-500">
          Údaje používame len na činnosť klubu a ich ochranu riešime podľa GDPR.{' '}
          <Link href="/dokumenty/ochrana-osobnych-udajov" className="text-club-600 hover:underline">
            Ochrana osobných údajov
          </Link>
        </p>
      </section>

      <section>
        <h2 className="text-xl font-bold text-club-900">Ako funguje portál</h2>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          {FEATURES.map((f) => (
            <div key={f.title} className="rounded-md bg-club-50 p-3">
              <h3 className="text-sm font-semibold text-club-800">{f.title}</h3>
              <p className="mt-1 text-sm">{f.text}</p>
            </div>
          ))}
        </div>
        <p className="mt-3 text-sm">
          Každý vidí len to, čo sa ho týka: rodič svoje deti, hráč seba, tréner svoje družstvá a vedenie celý klub.
        </p>
      </section>

      <p className="border-t border-club-100 pt-4 text-sm">
        Neviete si rady? Napíšte nám na <span className="font-semibold text-club-800">info@fkknv.sk</span> alebo navštívte{' '}
        <Link href="/podpora" className="text-club-600 hover:underline">
          Podporu
        </Link>
        .
      </p>
    </div>
  );
}
