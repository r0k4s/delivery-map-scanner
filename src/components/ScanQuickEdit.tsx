import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../lib/db';
import { updateDelivery } from '../lib/store';
import type { Template } from '../types';
import { ColorPicker, TemplateChips } from './ui';

/** Color + description quick buttons shown in the "Saved" toast right after a scan. */
export function ScanQuickEdit({ id, templates }: { id: string; templates: Template[] }) {
  const d = useLiveQuery(() => db.deliveries.get(id), [id]);
  if (!d) return null;
  return (
    <div className="space-y-2.5">
      <div className="-mx-4 overflow-x-auto px-4 py-1 no-scrollbar">
        <ColorPicker size="sm" nowrap value={d.color} onChange={(color) => updateDelivery(id, { color })} />
      </div>
      {templates.length > 0 && (
        <div className="-mx-4 overflow-x-auto px-4 no-scrollbar">
          <TemplateChips dark nowrap templates={templates} value={d.templateId} onChange={(templateId) => updateDelivery(id, { templateId })} />
        </div>
      )}
    </div>
  );
}
