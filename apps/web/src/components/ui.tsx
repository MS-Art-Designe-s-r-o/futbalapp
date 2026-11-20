'use client';

import type { ReactNode } from 'react';
import { positionShort } from '@fkknv/shared';

export const inputCls =
  'mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-club-500 focus:outline-none';
export const labelCls = 'block text-sm font-medium text-gray-700';

export function Button({
  children,
  onClick,
  type = 'button',
  variant = 'primary',
  disabled,
  className = '',
}: {
  children: ReactNode;
  onClick?: () => void;
  type?: 'button' | 'submit';
  variant?: 'primary' | 'ghost' | 'danger';
  disabled?: boolean;
  className?: string;
}) {
  const base = 'px-4 py-2 text-sm font-bold uppercase tracking-wide transition disabled:opacity-50';
  const styles = {
    primary: 'bg-club-600 text-white hover:bg-[#408bff]',
    ghost: 'border border-[#63707a] text-club-900 hover:bg-white/5',
    danger: 'border border-red-300 text-red-700 hover:bg-red-50',
  }[variant];
  return (
    <button type={type} onClick={onClick} disabled={disabled} className={`${base} ${styles} ${className}`}>
      {children}
    </button>
  );
}

export function Modal({
  open,
  onClose,
  title,
  children,
  wide,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  wide?: boolean;
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4">
      <div className={`mt-10 w-full border border-[#435461] bg-white shadow-2xl ${wide ? 'max-w-3xl' : 'max-w-lg'}`}>
        <div className="flex items-center justify-between border-b border-club-100 px-5 py-3">
          <h2 className="fk-h-sm text-xl font-bold text-club-900">{title}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-white" aria-label="Zavrieť">
            ✕
          </button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`fk-card ${className}`}>{children}</div>;
}

export function ErrorText({ children }: { children: ReactNode }) {
  if (!children) return null;
  return <p className="text-sm text-red-600">{children}</p>;
}

/** Malá skratka postavenia hráča (CB, CM…) za menom; nič, ak nie je zadané. */
export function PlayerPos({ position, position2 }: { position?: string | null; position2?: string | null }) {
  const short = [positionShort(position), position2 && position2 !== position ? positionShort(position2) : '']
    .filter(Boolean)
    .join(' · ');
  if (!short) return null;
  return (
    <span className="ml-1 whitespace-nowrap rounded bg-club-100 px-1 py-0.5 align-middle text-[10px] font-semibold text-club-700">
      {short}
    </span>
  );
}
