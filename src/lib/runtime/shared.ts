import { shouldUseClientRuntime } from "../runtime-mode";

export async function callRuntime<T>(
	clientCall: () => T | Promise<T>,
	serverCall: () => T | Promise<T>,
): Promise<T> {
	if (shouldUseClientRuntime()) {
		return clientCall();
	}

	return serverCall();
}
