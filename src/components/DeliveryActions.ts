import { useCallback } from 'react';
import { deleteDeliveries, restoreDeliveries, setDelivered } from '../lib/store';
import { streetLine, type Delivery, type Template } from '../types';
import { useToast } from './Toast';

export function describe(d: Delivery, templates: Template[]) {
  const t = d.templateId ? templates.find((x) => x.id === d.templateId)?.label : '';
  return [t, d.note].filter(Boolean).join(' – ');
}

/** Shared deliver / delete actions with Undo toasts. */
export function useDeliveryActions() {
  const toast = useToast();

  const deliver = useCallback(
    async (items: Delivery[], delivered = true) => {
      const ids = items.map((d) => d.id);
      await setDelivered(ids, delivered);
      navigator.vibrate?.(30);
      toast.show({
        tone: delivered ? 'success' : 'info',
        message: delivered
          ? items.length === 1
            ? `Delivered: ${streetLine(items[0])}`
            : `${items.length} packages delivered`
          : `Marked as pending again`,
        actions: [{ label: 'Undo', onClick: () => setDelivered(ids, !delivered) }],
      });
    },
    [toast],
  );

  const remove = useCallback(
    async (items: Delivery[]) => {
      const rows = await deleteDeliveries(items.map((d) => d.id));
      toast.show({
        tone: 'info',
        message: rows.length === 1 ? `Deleted #${rows[0].seq} ${streetLine(rows[0])}` : `Deleted ${rows.length} deliveries`,
        duration: 7000,
        actions: [{ label: 'Undo', primary: true, onClick: () => restoreDeliveries(rows) }],
      });
    },
    [toast],
  );

  return { deliver, remove };
}
