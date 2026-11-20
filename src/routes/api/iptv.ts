import { createFileRoute } from "@tanstack/react-router";

async function handle({ request }: { request: Request }) {
	const { iptvRequest } = await import("../../server/iptv");
	return iptvRequest(request);
}

export const Route = createFileRoute("/api/iptv")({
	server: { handlers: { GET: handle, HEAD: handle } },
});
