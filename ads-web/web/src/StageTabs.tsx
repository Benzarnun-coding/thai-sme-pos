import { useEffect, useRef } from 'react';
import type { CampaignView, Stage } from './api.ts';

/** 'none' = campaigns not put in any stage yet */
export type StageTab = string;

export const NONE: StageTab = 'none';
/** Every campaign, whatever its stage (overview only) */
export const ALL: StageTab = 'all';

/** Default: all stages together. */
export function defaultStageTab(_stages: Stage[], _campaigns: CampaignView[]): StageTab {
  return ALL;
}

export function campaignsIn(tab: StageTab, campaigns: CampaignView[]): CampaignView[] {
  if (tab === ALL) return campaigns;
  return campaigns.filter((c) => (tab === NONE ? !c.stage_id : c.stage_id === tab));
}

/** One tab per lifecycle stage (plus "not assigned"), each with its campaign count and stage colour. */
export function StageTabs({ stages, campaigns, value, onChange, withAll }: {
  stages: Stage[]; campaigns: CampaignView[]; value: StageTab; onChange: (t: StageTab) => void; withAll?: boolean;
}) {
  const tabs = [...(withAll ? [{ id: ALL, name: 'ทุกกลุ่มรวมกัน' }] : []), { id: NONE, name: 'ยังไม่จัด' }, ...stages];
  const bar = useRef<HTMLDivElement>(null);
  // On a phone the strip scrolls sideways; keep the selected tab visible (only the strip scrolls, not the page).
  useEffect(() => {
    const el = bar.current?.querySelector<HTMLElement>('.stage-tab.on');
    if (el && bar.current) bar.current.scrollLeft = el.offsetLeft - (bar.current.clientWidth - el.offsetWidth) / 2;
  }, [value]);
  return (
    <div className="stage-tabs" role="tablist" aria-label="กลุ่ม" ref={bar}>
      {tabs.map((t) => {
        const n = campaignsIn(t.id, campaigns).length;
        return (
          <button
            key={t.id}
            role="tab"
            aria-selected={value === t.id}
            className={`stage-tab stage-${t.id} ${value === t.id ? 'on' : ''}`}
            onClick={() => onChange(t.id)}
          >
            {t.name} <span className="count">{n}</span>
          </button>
        );
      })}
    </div>
  );
}
