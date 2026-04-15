export function isNativeShell() {
	if (typeof window === "undefined") return false;

	const runtimeWindow = window as Window & {
		Capacitor?: {
			isNativePlatform?: () => boolean;
		};
	};

	return Boolean(
		runtimeWindow.Capacitor?.isNativePlatform?.() ||
			window.location.protocol === "capacitor:" ||
			window.location.protocol === "ionic:",
	);
}

export function shouldUseClientRuntime() {
	return isNativeShell();
}
