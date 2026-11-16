import { useMemo } from "react";
import { loadSampleData, removeSampleData, SAMPLE_FOLDER } from "../../lib/sampleData";
import { useData } from "../../stores/data";
import { toast } from "../../stores/ui";

/** One button that adds the sample workspace, or removes it once it is there (FEAT-26). */
export function SampleDataButton({ className = "btn btn-sm" }: { className?: string }) {
  const folders = useData((s) => s.folders);
  const has = useMemo(() => Object.values(folders).some((f) => f.name === SAMPLE_FOLDER), [folders]);
  return (
    <button
      type="button"
      className={className}
      onClick={() => {
        if (has) {
          removeSampleData();
          toast("Sample data removed.");
        } else if (loadSampleData()) toast(`Added the “${SAMPLE_FOLDER}” folder. Remove it from Settings → General any time.`);
      }}
    >
      {has ? "Remove sample data" : "Try with sample data"}
    </button>
  );
}
