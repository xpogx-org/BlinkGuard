import { Button } from "@/components/button";
import { useT } from "@/i18n";
import { rendererIpc } from "@/shared/ipc/renderer-ipc";

export function DebugCleanButton() {
	const t = useT();

	return (
		<Button
			type="button"
			variant="outline"
			size="sm"
			onClick={() => rendererIpc.debugCleanPreview()}
		>
			{t("debug.clean")}
		</Button>
	);
}
