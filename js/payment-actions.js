// Atualização otimista de registros de pagamento, com rollback em caso de
// erro e toast de "Desfazer" (5 s). Usado por Pagamentos e Início.

import * as db from './db.js';
import { toast, toastError } from './ui.js';

const TRACKED_FIELDS = ['status', 'pago_em', 'valor'];

/**
 * getRecord(id) -> objeto do registro no estado da tela (é mutado no lugar)
 * onChange()    -> re-renderiza a tela
 */
export function createPaymentUpdater({ getRecord, onChange }) {
  const queues = new Map(); // id -> Promise: serializa requisições do mesmo registro
  const versions = new Map(); // id -> número da última alteração local

  async function apply(id, patch, { message, undoable = true } = {}) {
    const record = getRecord(id);
    if (!record) return false;

    const previous = {};
    for (const field of TRACKED_FIELDS) previous[field] = record[field];

    const version = (versions.get(id) ?? 0) + 1;
    versions.set(id, version);

    Object.assign(record, patch);
    onChange();

    const request = (queues.get(id) ?? Promise.resolve()).then(() => db.updatePayment(id, patch));
    queues.set(id, request.catch(() => null));
    const { data, error } = await request;
    const isLatest = versions.get(id) === version;

    if (error) {
      if (isLatest) {
        Object.assign(record, previous);
        onChange();
      }
      toastError(error);
      return false;
    }

    if (isLatest) {
      Object.assign(record, data);
      onChange();
    }

    if (message) {
      toast(message, undoable
        ? {
            actionLabel: 'Desfazer',
            duration: 5000,
            onAction: () => apply(id, previous, { message: 'Alteração desfeita.', undoable: false }),
          }
        : { duration: 3000 });
    }
    return true;
  }

  return { apply };
}
