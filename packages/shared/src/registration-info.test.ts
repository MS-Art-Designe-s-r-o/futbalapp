import { describe, expect, it } from 'vitest';
import { registrationInfoSchema } from './schemas';

const base = {
  firstName: 'Jano',
  lastName: 'Novák',
  birthDate: '2015-05-04',
  captcha: { token: 't', answer: 'a' },
};

describe('registrationInfoSchema', () => {
  it('prijme platné údaje', () => {
    expect(registrationInfoSchema.safeParse(base).success).toBe(true);
    expect(
      registrationInfoSchema.safeParse({ ...base, motherClub: 'FK A', photoBase64: 'data:image/png;base64,AAAA' }).success,
    ).toBe(true);
  });
  it('odmietne chybný dátum', () => {
    expect(registrationInfoSchema.safeParse({ ...base, birthDate: '2015-02-31' }).success).toBe(false);
    expect(registrationInfoSchema.safeParse({ ...base, birthDate: '4.5.2015' }).success).toBe(false);
  });
  it('odmietne budúci dátum a vek nad 60', () => {
    expect(registrationInfoSchema.safeParse({ ...base, birthDate: '2999-01-01' }).success).toBe(false);
    expect(registrationInfoSchema.safeParse({ ...base, birthDate: '1900-01-01' }).success).toBe(false);
  });
  it('odmietne krátke meno a chýbajúcu captchu', () => {
    expect(registrationInfoSchema.safeParse({ ...base, firstName: 'J' }).success).toBe(false);
    const { captcha: _c, ...noCaptcha } = base;
    expect(registrationInfoSchema.safeParse(noCaptcha).success).toBe(false);
  });
  it('odmietne iný typ fotky', () => {
    expect(registrationInfoSchema.safeParse({ ...base, photoBase64: 'data:image/gif;base64,AAAA' }).success).toBe(false);
    expect(registrationInfoSchema.safeParse({ ...base, photoBase64: 'data:text/html;base64,AAAA' }).success).toBe(false);
  });
});
