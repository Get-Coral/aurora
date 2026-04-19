import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import type { MediaItem } from "../lib/media";
import { MediaPlayerDialog } from "./MediaPlayerDialog";
import { MediaSpotlightDialog } from "./MediaSpotlightDialog";
import { useFavoriteAction } from "./useFavoriteAction";

export function GlobalMediaDialogs() {
	const [selectedItem, setSelectedItem] = useState<MediaItem | null>(null);
	const [playingItem, setPlayingItem] = useState<MediaItem | null>(null);
	const [playQueue, setPlayQueue] = useState<MediaItem[]>([]);
	const favoriteMutation = useFavoriteAction();
	const queryClient = useQueryClient();

	useEffect(() => {
		document.documentElement.dataset.auroraPlaying = playingItem ? "true" : "false";
	}, [playingItem]);

	useEffect(() => {
		function handleSelect(event: Event) {
			const customEvent = event as CustomEvent<MediaItem>;
			setSelectedItem(customEvent.detail);
		}

		function handlePlay(event: Event) {
			const customEvent = event as CustomEvent<{ item: MediaItem; queue?: MediaItem[] }>;
			const { item, queue } = customEvent.detail;
			if (!item.streamUrl || item.type === "series") return;
			setSelectedItem(null);
			setPlayQueue(queue?.length ? queue : [item]);
			setPlayingItem(item);
		}

		window.addEventListener("aurora:select-media", handleSelect as EventListener);
		window.addEventListener("aurora:play-media", handlePlay as EventListener);
		return () => {
			window.removeEventListener("aurora:select-media", handleSelect as EventListener);
			window.removeEventListener("aurora:play-media", handlePlay as EventListener);
		};
	}, []);

	function playMedia(item: MediaItem, queue: MediaItem[] = []) {
		if (!item.streamUrl || item.type === "series") return;
		setSelectedItem(null);
		setPlayQueue(queue.length ? queue : [item]);
		setPlayingItem(item);
	}

	function handleToggleFavorite(item: MediaItem) {
		setSelectedItem((current) =>
			current?.id === item.id ? { ...current, isFavorite: !current.isFavorite } : current,
		);
		favoriteMutation.mutate({ id: item.id, isFavorite: Boolean(item.isFavorite) });
	}

	function handleWatchedChange(id: string, played: boolean) {
		const patchList = (items: MediaItem[]) =>
			items.map((i) => (i.id === id ? { ...i, played } : i));

		queryClient.setQueriesData<MediaItem[]>({ queryKey: ["continue-watching"] }, (old) =>
			old ? patchList(old) : old,
		);
		queryClient.setQueriesData<MediaItem[]>({ queryKey: ["latest-movies"] }, (old) =>
			old ? patchList(old) : old,
		);
		queryClient.setQueriesData<MediaItem[]>({ queryKey: ["latest-series"] }, (old) =>
			old ? patchList(old) : old,
		);
		queryClient.setQueriesData<MediaItem[]>({ queryKey: ["favorite-movies"] }, (old) =>
			old ? patchList(old) : old,
		);
	}

	return (
		<>
			<MediaPlayerDialog
				item={playingItem}
				open={playingItem != null}
				onClose={() => setPlayingItem(null)}
				queue={playQueue}
				onSelectQueueItem={setPlayingItem}
			/>

			<MediaSpotlightDialog
				item={selectedItem}
				open={selectedItem != null}
				onClose={() => setSelectedItem(null)}
				onPlay={(item, queue) => playMedia(item, queue ?? [item])}
				onSelectSimilar={setSelectedItem}
				onToggleFavorite={handleToggleFavorite}
				onWatchedChange={handleWatchedChange}
			/>
		</>
	);
}
