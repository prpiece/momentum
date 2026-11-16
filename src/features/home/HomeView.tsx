import { format } from "date-fns";
import { ClipboardCheck, MoonStar, Sun } from "lucide-react";
import { PageHead } from "../../components/ui/PageHead";
import { greeting } from "../../domain/home";
import { go, openPlanning } from "../../stores/ui";
import { FocusCard } from "./FocusCard";
import { HabitsCard } from "./HabitsCard";
import { NextUpCard } from "./NextUpCard";
import { SectionTiles } from "./SectionTiles";
import { TodayCard } from "./TodayCard";

/** Home (D268): a read-only overview of today with a way into every section. It keeps no state of its own. */
export function HomeView() {
  const now = new Date();
  return (
    <div className="h-full overflow-y-auto px-[var(--gutter)] pb-10 pt-6">
      <div className="mx-auto flex max-w-[960px] flex-col gap-4">
        <PageHead title={greeting(now.getHours())} sub={format(now, "EEEE d MMMM")}>
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => openPlanning("plan")}>
            <Sun size={14} /> Plan my day
          </button>
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => openPlanning("shutdown")}>
            <MoonStar size={14} /> Shut down
          </button>
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => go("review")}>
            <ClipboardCheck size={14} /> Review
          </button>
        </PageHead>
        <div className="grid grid-cols-1 gap-3 min-[720px]:grid-cols-2">
          <TodayCard />
          <NextUpCard />
          <HabitsCard />
          <FocusCard />
        </div>
        <SectionTiles />
      </div>
    </div>
  );
}
