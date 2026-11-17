// Country of a phone number from its international dialling code. Pure, no network.
// Longest matching prefix wins (e.g. 1242 Bahamas before 1 USA). Numbers without a known code get no flag.
const CODES: Record<string, string> = {
  '1': 'US', '7': 'RU', '20': 'EG', '27': 'ZA', '30': 'GR', '31': 'NL', '32': 'BE', '33': 'FR', '34': 'ES', '36': 'HU',
  '39': 'IT', '40': 'RO', '41': 'CH', '43': 'AT', '44': 'GB', '45': 'DK', '46': 'SE', '47': 'NO', '48': 'PL', '49': 'DE',
  '51': 'PE', '52': 'MX', '53': 'CU', '54': 'AR', '55': 'BR', '56': 'CL', '57': 'CO', '58': 'VE', '60': 'MY', '61': 'AU',
  '62': 'ID', '63': 'PH', '64': 'NZ', '65': 'SG', '66': 'TH', '81': 'JP', '82': 'KR', '84': 'VN', '86': 'CN', '90': 'TR',
  '91': 'IN', '92': 'PK', '93': 'AF', '94': 'LK', '95': 'MM', '98': 'IR', '212': 'MA', '213': 'DZ', '216': 'TN', '218': 'LY',
  '234': 'NG', '254': 'KE', '255': 'TZ', '256': 'UG', '351': 'PT', '352': 'LU', '353': 'IE', '354': 'IS', '358': 'FI',
  '359': 'BG', '370': 'LT', '371': 'LV', '372': 'EE', '373': 'MD', '374': 'AM', '375': 'BY', '380': 'UA', '381': 'RS',
  '385': 'HR', '420': 'CZ', '421': 'SK', '503': 'SV', '506': 'CR', '507': 'PA', '591': 'BO', '593': 'EC', '595': 'PY',
  '598': 'UY', '852': 'HK', '880': 'BD', '886': 'TW', '960': 'MV', '961': 'LB', '962': 'JO', '963': 'SY', '964': 'IQ',
  '965': 'KW', '966': 'SA', '967': 'YE', '968': 'OM', '971': 'AE', '972': 'IL', '973': 'BH', '974': 'QA', '975': 'BT',
  '976': 'MN', '977': 'NP', '992': 'TJ', '993': 'TM', '994': 'AZ', '995': 'GE', '996': 'KG', '998': 'UZ', '77': 'KZ',
};
// Kazakhstan shares +7 with Russia: 76x/77x are Kazakh mobile and landline ranges.
const SPECIAL: Array<[RegExp, string]> = [[/^7[67]/, 'KZ']];

const NAMES = new Intl.DisplayNames(['ru'], { type: 'region' });

export function countryCode(waId: string): string | null {
  const d = (waId ?? '').replace(/\D/g, '');
  if (!d) return null;
  for (const [re, cc] of SPECIAL) if (re.test(d)) return cc;
  for (const len of [3, 2, 1]) {
    const cc = CODES[d.slice(0, len)];
    if (cc) return cc;
  }
  return null;
}

export function countryFlag(cc: string): string {
  return String.fromCodePoint(...[...cc.toUpperCase()].map((ch) => 0x1f1e6 + ch.charCodeAt(0) - 65));
}

/** { flag, name } for a number, or null when the dialling code is unknown. */
export function countryOf(waId: string): { flag: string; name: string } | null {
  const cc = countryCode(waId);
  if (!cc) return null;
  let name = cc;
  try { name = NAMES.of(cc) ?? cc; } catch { /* keep code */ }
  return { flag: countryFlag(cc), name };
}
