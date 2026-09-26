import { createFileRoute } from "@tanstack/react-router";

/**
 * What this module is.
 *
 * Aurora is a viewer. It reads a Jellyfin library and shows it; it has
 * nothing another Coral module needs to call, so this answers with an empty
 * capability list and asks for no credential. That is the honest answer, not
 * a placeholder — advertising an auth scheme with nothing behind it, or a
 * token panel with nothing to grant, would be a dead payload that looks
 * functional.
 *
 * It still exists because discovery is the point: the Connections flow is
 * "paste a URL, see what this is, paste a token if it wants one", and the
 * first step has to work against every module. A caller learns this is
 * Aurora, which spec it speaks, and that there is nothing here to wire up.
 *
 * When Aurora does grow a capability, `auth` gains `required: true` and the
 * token machinery arrives with it.
 *
 * Compatibility rules: `spec` is a single integer for the envelope, each
 * capability will carry its own integer version, `path` is declared rather
 * than derived from the name, and parsers must ignore unknown fields rather
 * than throwing.
 */

const SPEC = 1;

export const Route = createFileRoute("/api/coral/manifest")({
	server: {
		handlers: {
			GET: async () => {
				const { version } = await import("../../../../package.json");

				return Response.json({
					spec: SPEC,
					module: { id: "aurora", name: "Aurora", version },
					auth: { required: false, schemes: [] },
					capabilities: [],
				});
			},
		},
	},
});
