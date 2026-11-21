export declare const DESKTOP_ENTRY_PATH: string;

export interface DesktopRefusal {
	status: number;
	headers?: Record<string, string>;
	body?: string;
}

export declare function createDesktopGuard(options: {
	token: string | undefined;
	port: number;
}):
	| ((
			headers: Record<string, string | string[] | undefined>,
			url: URL,
			options?: { publicFile?: boolean },
	  ) => DesktopRefusal | null)
	| null;
