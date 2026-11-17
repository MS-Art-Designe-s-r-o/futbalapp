import Image from 'next/image';

const ANDROID_APP_URL = 'https://play.google.com/store/apps/details?id=sk.fkknv.app';
const IOS_APP_URL = 'https://apps.apple.com/sk/app/fk-knv/id6805670800';

/** Zjednodušená ilustrácia obrazovky aplikácie v telefóne (nie skutočný snímok). */
function Phone({ platform }: { platform: 'android' | 'ios' }) {
  const ios = platform === 'ios';
  return (
    <div
      className={`relative mx-auto w-40 border-[6px] border-gray-900 bg-gray-900 shadow-lg ${ios ? 'rounded-[30px]' : 'rounded-[22px]'}`}
      role="img"
      aria-label={`Ukážka aplikácie FK KNV na ${ios ? 'iPhone' : 'Androide'}`}
    >
      {ios ? (
        <span className="absolute left-1/2 top-1.5 z-10 h-3 w-14 -translate-x-1/2 rounded-full bg-gray-900" />
      ) : (
        <span className="absolute left-1/2 top-2 z-10 h-2 w-2 -translate-x-1/2 rounded-full bg-gray-900" />
      )}
      <div className={`overflow-hidden bg-[#ffffff] ${ios ? 'rounded-[24px]' : 'rounded-[16px]'}`}>
        <div className="bg-[#1a2848] px-3 pb-2 pt-7 text-[#ffffff]">
          <p className="text-[9px] uppercase tracking-widest text-[#c9d3ea]">FK KNV</p>
          <p className="text-sm font-bold leading-tight">Dnes</p>
        </div>
        <div className="space-y-2 p-2.5">
          <div className="rounded-md bg-[#eef2f9] p-2">
            <p className="text-[9px] font-semibold uppercase text-[#2b4278]">Tréning · U10</p>
            <p className="text-[11px] font-semibold text-[#16223c]">17:00 – 18:30</p>
            <p className="text-[9px] text-[#667085]">Umelka Nová Ves</p>
            <span className="mt-1 inline-block rounded bg-[#2b4278] px-1.5 py-0.5 text-[9px] font-semibold text-[#ffffff]">Zúčastní sa ✓</span>
          </div>
          <div className="rounded-md bg-[#fff6e0] p-2">
            <p className="text-[9px] font-semibold uppercase text-[#9a6200]">Zápas · sobota</p>
            <p className="text-[11px] font-semibold text-[#16223c]">FK KNV – súper</p>
            <p className="text-[9px] text-[#667085]">Nominácia: ste nominovaný</p>
          </div>
          <div className="flex items-center justify-between rounded-md border border-[#dde3ef] p-2">
            <span className="text-[10px] text-[#475467]">Členské</span>
            <span className="rounded bg-[#dcf5d8] px-1.5 py-0.5 text-[9px] font-semibold text-[#1d6b2a]">Uhradené</span>
          </div>
        </div>
        <div className="flex justify-around border-t border-[#dde3ef] py-1.5 text-[8px] text-[#667085]">
          <span className="font-semibold text-[#2b4278]">Domov</span>
          <span>Kalendár</span>
          <span>Chat</span>
          <span>Platby</span>
        </div>
      </div>
    </div>
  );
}

function Store({ platform }: { platform: 'android' | 'ios' }) {
  const ios = platform === 'ios';
  const url = ios ? IOS_APP_URL : ANDROID_APP_URL;
  return (
    <div className="flex flex-col items-center text-center">
      <Phone platform={platform} />
      <h3 className="mt-4 font-semibold text-club-800">{ios ? 'iPhone (iOS)' : 'Android'}</h3>
      <a href={url} target="_blank" rel="noopener noreferrer" className="mt-2 inline-block">
        <Image
          src={ios ? '/app-ios-qr.png' : '/app-android-qr.png'}
          alt={`QR kód na stiahnutie aplikácie z ${ios ? 'App Store' : 'Google Play'}`}
          width={110}
          height={110}
          className="rounded-md border border-club-100 bg-white"
        />
      </a>
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className={`mt-3 inline-block rounded-md px-4 py-2 text-sm font-semibold text-[#ffffff] ${ios ? 'bg-[#0a1118] ring-1 ring-[#4a5863] hover:bg-[#16223c]' : 'bg-[#2b4278] hover:bg-[#1a2848]'}`}
      >
        {ios ? 'Stiahnuť z App Store' : 'Otvoriť v Google Play'}
      </a>
    </div>
  );
}

export default function AppDownload() {
  return (
    <section>
      <span className="inline-block rounded-full bg-club-600 px-3 py-1 text-xs font-bold uppercase tracking-wide text-white">
        Pre rodičov
      </span>
      <h2 className="mt-2 text-xl font-bold text-club-900">Aplikácia FK KNV v telefóne</h2>
      <p className="mt-1 text-sm">
        Mobilná aplikácia je určená hlavne <strong>rodičom</strong>: na jednom mieste vidíte tréningy a zápasy detí,
        potvrdíte účasť, dostanete upozornenia na zmeny termínov, oznamy trénera a prehľad platieb.
      </p>
      <div className="mt-5 grid gap-8 sm:grid-cols-2">
        <Store platform="android" />
        <Store platform="ios" />
      </div>
      <p className="mt-4 text-xs text-gray-500">
        Prihlásite sa rovnakým e-mailom a heslom ako do portálu. Ukážka obrazovky je ilustračná.
      </p>
    </section>
  );
}
