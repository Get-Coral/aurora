import {
	createClientAdminUser,
	deleteClientAdminUser,
	fetchClientAdminLibraries,
	fetchClientAdminOverview,
	fetchClientAdminSessions,
	fetchClientAdminUsers,
	scanAllClientAdminLibraries,
	scanClientAdminLibrary,
	toggleClientAdminUser,
} from "@/lib/client-media";
import {
	createAdminUser,
	deleteAdminUser,
	fetchAdminLibraries,
	fetchAdminOverview,
	fetchAdminSessions,
	fetchAdminUsers,
	scanAdminLibrary,
	scanAllAdminLibraries,
	toggleAdminUser,
} from "@/server/functions";
import { callRuntime } from "./shared";

export async function fetchAdminOverviewRuntime() {
	return callRuntime(
		() => fetchClientAdminOverview(),
		() => fetchAdminOverview(),
	);
}

export async function fetchAdminSessionsRuntime() {
	return callRuntime(
		() => fetchClientAdminSessions(),
		() => fetchAdminSessions(),
	);
}

export async function fetchAdminUsersRuntime() {
	return callRuntime(
		() => fetchClientAdminUsers(),
		() => fetchAdminUsers(),
	);
}

export async function toggleAdminUserRuntime(input: {
	data: { userId: string; disabled: boolean };
}) {
	return callRuntime(
		() => toggleClientAdminUser(input.data),
		() => toggleAdminUser(input),
	);
}

export async function deleteAdminUserRuntime(input: { data: { userId: string } }) {
	return callRuntime(
		() => deleteClientAdminUser(input.data.userId),
		() => deleteAdminUser(input),
	);
}

export async function createAdminUserRuntime(input: { data: { name: string; password: string } }) {
	return callRuntime(
		() => createClientAdminUser(input.data),
		() => createAdminUser(input),
	);
}

export async function fetchAdminLibrariesRuntime() {
	return callRuntime(
		() => fetchClientAdminLibraries(),
		() => fetchAdminLibraries(),
	);
}

export async function scanAllAdminLibrariesRuntime() {
	return callRuntime(
		() => scanAllClientAdminLibraries(),
		() => scanAllAdminLibraries(),
	);
}

export async function scanAdminLibraryRuntime(input: { data: { itemId: string } }) {
	return callRuntime(
		() => scanClientAdminLibrary(input.data.itemId),
		() => scanAdminLibrary(input),
	);
}
