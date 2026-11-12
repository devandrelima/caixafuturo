import { isValidISODate } from '../domain/finance/dates';
import { centsFromString } from '../domain/finance/money';
import { PAYMENT_METHODS } from '../domain/sales/types';
import type { Sale } from '../domain/sales/types';
import { StorageError } from './db';

const invalid = (message: string) => new StorageError('invalid', message);

/** Validação na fronteira de gravação: dado inválido nunca chega ao IndexedDB. */
export function validateSale(s: Sale): void {
  if (!s.id || !s.saleKey) throw invalid('Venda sem identificação.');
  if (!isValidISODate(s.saleDate)) throw invalid('Data da venda inválida.');
  if (!PAYMENT_METHODS.includes(s.method)) throw invalid('Meio de pagamento inválido.');
  let cents: bigint;
  try {
    cents = centsFromString(s.grossCents);
  } catch {
    throw invalid('Valor da venda inválido.');
  }
  if (cents <= 0n) throw invalid('O valor da venda deve ser maior que zero.');
}
