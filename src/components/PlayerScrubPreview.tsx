import { getTrickplayFrame, type TrickplayPreview } from "../lib/trickplay";

/** Width the thumbnail is shown at, whatever size Jellyfin generated. */
const DISPLAY_WIDTH = 192;

interface PlayerScrubPreviewProps {
	/** Movie time being pointed at or dragged to. */
	time: number;
	duration: number;
	label: string;
	trickplay: TrickplayPreview | null | undefined;
}

/**
 * The time (and, when Jellyfin has generated them, a thumbnail) above the
 * progress bar for the spot being hovered or dragged to.
 */
export function PlayerScrubPreview({ time, duration, label, trickplay }: PlayerScrubPreviewProps) {
	const ratio = duration > 0 ? Math.max(0, Math.min(1, time / duration)) : 0;
	const frame = trickplay ? getTrickplayFrame(trickplay, time) : null;
	const scale = trickplay ? DISPLAY_WIDTH / trickplay.width : 1;
	const halfWidth = frame ? DISPLAY_WIDTH / 2 : 32;

	return (
		<div
			className="player-scrub-preview"
			aria-hidden="true"
			// Centred on the pointer, but kept fully on screen at either end.
			style={{
				left: `clamp(${halfWidth}px, ${ratio * 100}%, calc(100% - ${halfWidth}px))`,
			}}
		>
			{frame && trickplay ? (
				<div
					className="player-scrub-thumb"
					style={{
						width: DISPLAY_WIDTH,
						height: trickplay.height * scale,
						backgroundImage: `url("${frame.url}")`,
						backgroundSize: `${trickplay.tileWidth * trickplay.width * scale}px auto`,
						backgroundPosition: `${-frame.x * scale}px ${-frame.y * scale}px`,
					}}
				/>
			) : null}
			<span className="player-scrub-time">{label}</span>
		</div>
	);
}
