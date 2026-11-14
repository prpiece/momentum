import type { TodayWidgetProps } from "@core/domain/todayWidget";

/** Pushes new props to the Today widgets. Implemented per platform (today.ios.tsx, today.android.tsx). */
export function updateTodayWidgets(props: TodayWidgetProps): void;
