import { useEffect, useState } from "react";
import { fetchMultiUserSettingsRuntime } from "./runtime-functions";

export type MultiUserState = {
	multiUserMode: boolean;
	activeUserId: string | null;
	locked: boolean;
};

const DEFAULT_STATE: MultiUserState = {
	multiUserMode: false,
	activeUserId: null,
	locked: false,
};

export function useMultiUserMode(): MultiUserState {
	const [state, setState] = useState<MultiUserState>(DEFAULT_STATE);

	useEffect(() => {
		fetchMultiUserSettingsRuntime()
			.then((result) => setState(result))
			.catch(() => setState(DEFAULT_STATE));
	}, []);

	return state;
}
